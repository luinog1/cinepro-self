import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult,
    Source,
    Subtitle
} from '@omss/framework';
import axios from 'axios';
import { VidnestResponse } from './popr.types.js';
import path from 'node:path';
export class PoprProvider extends BaseProvider {
    readonly id = 'popr';
    readonly name = 'Popr';
    readonly enabled = true;
    readonly BASE_URL = 'https://popr.ink';
    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
        Referer: `${this.BASE_URL}/`
    };

    readonly capabilities: ProviderCapabilities = {
        supportedContentTypes: ['movies', 'tv']
    };

    /**
     * Fetch movie sources
     */
    async getMovieSources(media: ProviderMediaObject): Promise<ProviderResult> {
        try {
            this.console.log('fetching movie response', media);
            let movieSource = await this.fetchSource(media, 'movie');

            return {
                sources: movieSource.sources,
                subtitles: movieSource.subtitles,
                diagnostics: []
            };
        } catch (error) {
            this.console.error(
                error instanceof Error
                    ? error.message
                    : 'error at getting movie source'
            );
            return this.emptyResult(
                error instanceof Error
                    ? error.message
                    : 'error at getting source',
                media
            );
        }
    }

    /**
     * Fetch TV episode sources
     */
    async getTVSources(media: ProviderMediaObject): Promise<ProviderResult> {
        try {
            this.console.log('fetching tv response', media);
            let tvSource = await this.fetchSource(media, 'tv');

            return {
                sources: tvSource.sources,
                subtitles: tvSource.subtitles,
                diagnostics: []
            };
        } catch (error) {
            this.console.error(
                error instanceof Error
                    ? error.message
                    : 'error at getting movie source'
            );
            return this.emptyResult(
                error instanceof Error
                    ? error.message
                    : 'error at getting source',
                media
            );
        }
    }

    // https://popr.ink/api/vidnest?id=262848&type=tv&server=catflix&season=1&episode=1
    private async fetchSource(
        media: ProviderMediaObject,
        type: 'tv' | 'movie' = 'movie'
    ): Promise<{ sources: Source[]; subtitles: Subtitle[] }> {
        let servers = [
            'default',
            'catflix',
            'hexa',
            'Gama',
            'Liligoon',
            'Sigma',
            'Prime',
            'Alfa',
            'Lamda',
            'ynx_vidsrc'
        ];
        let playType = 'tv';
        let ep = media.e || 1;
        let season = media.s || 1;
        let requestUrl = '';

        for (const server of servers) {
            try {
                if (type === 'tv') {
                    requestUrl = `${this.BASE_URL}/api/vidnest?id=${media.tmdbId}&type=${playType}&server=${server}&season=${season}&episode=${ep}`;
                }
                if (type === 'movie') {
                    requestUrl =
                        `${this.BASE_URL}/api/vidnest?id=${media.tmdbId}&type=movie` +
                        (server !== 'default' ? `&server=${server}` : '');
                }
                let data = await axios.get<VidnestResponse>(requestUrl, {
                    headers: { ...this.HEADERS, Referer: `${this.BASE_URL}/` }
                });
                let response = data.data;
                let url = response?.results?.[0].streams?.[0].url;
                if (!url) continue;
                let streamHeader = response?.results?.[0].streams?.[0].headers;
                let quality = response?.results?.[0].streams?.[0].quality;
                let streamType = path.extname(new URL(url).pathname);
                const subtitles = response.results?.[0]?.subtitles || [];
                let INVALID_QUALITIES = ['Hindi', 'English', 'MAIN'];
                let QUALITIES = ['Hindi', 'English'];
                let languages = QUALITIES.includes(quality);
                return {
                    sources: [
                        {
                            url: this.createProxyUrl(url, streamHeader),
                            type: streamType === '.m3u8' ? 'hls' : 'mp4',
                            quality: INVALID_QUALITIES.includes(quality)
                                ? 'auto'
                                : quality || 'auto',
                            audioTracks: [
                                {
                                    language: languages
                                        ? quality.toLowerCase().substring(0, 3)
                                        : 'eng',
                                    label: languages ? quality : 'English'
                                }
                            ],
                            provider: { name: this.name, id: this.id }
                        }
                    ],
                    subtitles: subtitles.map((sub) => ({
                        url: sub.url,
                        format: 'vtt',
                        label: sub.lang || 'Unknown'
                    }))
                };
            } catch (error) {
                continue;
            }
        }
        return {
            sources: [],
            subtitles: []
        };
    }

    private emptyResult(
        message: string,
        media: ProviderMediaObject
    ): ProviderResult {
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
    /**
     * Health check
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await axios.head(this.BASE_URL, {
                timeout: 5000,
                headers: this.HEADERS
            });
            return response.status === 200;
        } catch {
            return false;
        }
    }
}
