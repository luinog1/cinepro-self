import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Subtitle,
    AudioTrack,
    Diagnostic,
    Source,
    SourceType
} from '@omss/framework';
import { BaseProvider } from '@omss/framework';
import { ApiResponse, EncryptedPayload } from './streammafia.types.js';
import { decryptStreamMafia } from './decrypt.js';

export class StreamMafiaProvider extends BaseProvider {
    readonly id = 'streammafia';
    readonly name = 'MafiaEmbed';
    readonly enabled = true;

    readonly BASE_URL = 'https://embedmafia.in';
    readonly EMBED_URL = 'https://nhd.streammafia.to';

    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: this.EMBED_URL + '/',
        Origin: this.EMBED_URL
    };

    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv']
    };

    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        return this.getSources(media);
    }

    async healthCheck(): Promise<boolean> {
        try {
            const res = await fetch(this.BASE_URL, {
                method: 'HEAD',
                headers: this.HEADERS            
            });
            return res.status === 200;
        } catch {
            return false;
        }
    }

    private async getSources(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        try {
            const url = this.buildPageUrl(media);
            const encrypted = await this.fetchPage(url);

            if (!encrypted) {
                return this.emptyResult('Invalid API response');
            }

            const api = decryptStreamMafia(encrypted);
            return await this.mapApiResponse(api);
        } catch (err) {
            return this.emptyResult(
                err instanceof Error ? err.message : 'Unknown error'
            );
        }
    }

    private buildPageUrl(media: ProviderMediaObject): string {
        if (media.type === 'movie') {
            return `${this.BASE_URL}/api/movie/?id=${media.tmdbId}`;
        }

        return `${this.BASE_URL}/api/?tv=${media.tmdbId}&season=${media.s}&episode=${media.e}`;
    }

    private async fetchPage(url: string): Promise<EncryptedPayload | null> {
        try {
            const res = await fetch(url, { headers: this.HEADERS });
            if (res.status !== 200) return null;
            return await res.json() as EncryptedPayload;
        } catch {
            return null;
        }
    }

    private async mapApiResponse(api: ApiResponse): Promise<ProviderResult> {
        const sources: Source[] = [];
        const subtitles: Subtitle[] = [];
        const diagnostics: Diagnostic[] = [];

        const fallbackAudio = this.extractAudioTrack(api.selected);

        if (api.stream?.hls_streaming) {
            const parsed = await this.parseHLS(api.stream.hls_streaming);

            sources.push({
                url: this.createProxyUrl(api.stream.hls_streaming, {
                    ...this.HEADERS,
                    Referer: this.EMBED_URL + '/',
                    Origin: this.EMBED_URL
                }),
                type: 'hls',
                quality: parsed.quality || 'auto',
                audioTracks:
                    parsed.audioTracks.length > 0
                        ? parsed.audioTracks
                        : [fallbackAudio],
                provider: {
                    id: this.id,
                    name: this.name
                }
            });

            if (parsed.audioTracks.length === 0) {
                diagnostics.push({
                    code: 'LANGUAGE_INFERRED',
                    message: `${this.name}: Audio language inferred from selected payload`,
                    field: '',
                    severity: 'info'
                });
            }
        }

        for (const download of api.stream?.download ?? []) {
            sources.push({
                url: this.createProxyUrl(download.url, {
                    ...this.HEADERS,
                    Referer: this.EMBED_URL + '/',
                    Origin: this.EMBED_URL
                }),
                type: this.inferSourceType(download.url),
                quality: this.normalizeQuality(download.quality, 'unknown'),
                audioTracks: [fallbackAudio],
                provider: {
                    id: this.id,
                    name: this.name
                }
            });
        }

        if (!api.stream?.hls_streaming && !api.stream?.download?.length) {
            diagnostics.push({
                code: 'PROVIDER_ERROR',
                message: `${this.name}: No playable sources found in API response`,
                field: '',
                severity: 'error'
            });
        }

        if ((api.switches?.length ?? 0) > 0) {
            diagnostics.push({
                code: 'PARTIAL_SCRAPE',
                message: `${this.name}: Alternate switches were returned but only the selected stream was mapped`,
                field: 'switches',
                severity: 'info'
            });
        }

        return { sources, subtitles, diagnostics };
    }

    private extractAudioTrack(selected: ApiResponse['selected']): AudioTrack {
        const language =
            selected?.lang_code?.trim().toLowerCase() ||
            selected?.lang?.trim().toLowerCase() ||
            'unknown';

        const label =
            selected?.lang?.trim() ||
            selected?.lang_code?.toUpperCase() ||
            'Unknown';

        return {
            language,
            label
        };
    }

    private async parseHLS(url: string): Promise<{
        quality: string;
        audioTracks: AudioTrack[];
    }> {
        try {
            const res = await fetch(url, {
                headers: {
                    ...this.HEADERS,
                    Referer: this.EMBED_URL + '/'
                }
            });

            const content: string = await res.text();
            const variants = this.parseVariants(content);
            const audioTracks = this.parseAudioTracks(content);

            if (variants.length === 0) {
                return { quality: 'auto', audioTracks };
            }

            const best = variants.reduce((a, b) =>
                b.resolution > a.resolution ? b : a
            );

            return {
                quality: `${best.resolution}p`,
                audioTracks
            };
        } catch {
            return { quality: 'auto', audioTracks: [] };
        }
    }

    private parseVariants(content: string): Array<{ resolution: number }> {
        const variants: Array<{ resolution: number }> = [];
        const regex = /RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g;

        let match: RegExpExecArray | null;
        while ((match = regex.exec(content)) !== null) {
            variants.push({
                resolution: parseInt(match[1], 10)
            });
        }

        return variants;
    }

    private parseAudioTracks(content: string): AudioTrack[] {
        const tracks: AudioTrack[] = [];
        const lines = content.split('\n');

        for (const line of lines) {
            if (!line.includes('TYPE=AUDIO')) continue;

            const language =
                line.match(/LANGUAGE="([^"]+)"/)?.[1]?.toLowerCase() ??
                'unknown';
            const label = line.match(/NAME="([^"]+)"/)?.[1] ?? language;

            tracks.push({
                language,
                label
            });
        }

        return tracks;
    }

    private inferSourceType(url: string): SourceType {
        const clean = url.toLowerCase().split('?')[0];

        if (clean.endsWith('.m3u8')) return 'hls';
        if (clean.endsWith('.mpd')) return 'dash';
        if (clean.endsWith('.mp4')) return 'mp4';
        if (clean.endsWith('.mkv')) return 'mkv';
        if (clean.endsWith('.webm')) return 'webm';

        return 'hls';
    }

    private normalizeQuality(value?: string, fallback = 'unknown'): string {
        if (!value) return fallback;

        const v = value.toLowerCase();

        if (v.includes('2160')) return '2160';
        if (v.includes('1080')) return '1080';
        if (v.includes('720')) return '720';
        if (v.includes('480')) return '480';
        if (v.includes('360')) return '360';
        if (v.includes('240')) return '240';

        return value;
    }

    private emptyResult(message: string): ProviderResult {
        return {
            sources: [],
            subtitles: [],
            diagnostics: [
                {
                    code: 'PROVIDER_ERROR',
                    message: `${this.name}: ${message}`,
                    field: '',
                    severity: 'error'
                }
            ]
        };
    }
}
