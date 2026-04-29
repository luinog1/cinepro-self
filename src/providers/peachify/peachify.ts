import { BaseProvider } from '@omss/framework';
import type {
    ProviderCapabilities,
    ProviderMediaObject,
    ProviderResult
} from '@omss/framework';
import type {
    PeachifyApiResponse,
    PeachifyParsedSource,
    PeachifyParsedSubtitle,
    PeachifyRawSource,
    PeachifyRawSubtitle
} from './peachify.types.js';
/**
 * aes-gcm decryption key used by peachify for encrypted api responses.
 * this is embedded in their frontend bundle.
 */
const ENCRYPTION_KEY =
    'd8f2a1b5e9c470814f6b2c3a5d8e7f901a2b3c4d5e3f7a8b9c0d1e2f3a4b5c6d';

/**
 * list of peachify-compatible api base urls.
 * the framework will try each in order and merge all results.
 */
const PEACHIFY_SERVERS = [
    'https://uwu.peachify.top/moviebox',
    'https://usa.eat-peach.sbs/holly',
    'https://usa.eat-peach.sbs/air',
    'https://usa.eat-peach.sbs/multi',
    'https://usa.eat-peach.sbs/ice',
    'https://usa.eat-peach.sbs/net'
] as const;

export class PeachifyProvider extends BaseProvider {
    readonly id = 'Peachify';
    readonly name = 'Peachify';
    readonly enabled = true;
    readonly BASE_URL = 'https://peachify.top';
    readonly HEADERS = {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: this.BASE_URL,
        Origin: this.BASE_URL
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

    /**
     * fans out requests to all known peachify servers in parallel,
     * then merges whatever came back. partial failures are reported
     * as diagnostics rather than hard errors so the caller still
     * gets usable sources from the servers that did respond.
     */
    private async getSources(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        const results = await Promise.allSettled(
            PEACHIFY_SERVERS.map((server) =>
                this.fetchFromServer(server, media)
            )
        );

        const sources: ProviderResult['sources'] = [];
        const subtitles: ProviderResult['subtitles'] = [];
        const diagnostics: ProviderResult['diagnostics'] = [];

        let failCount = 0;

        for (const result of results) {
            if (result.status === 'rejected') {
                failCount++;
                continue;
            }

            if (!result.value) {
                failCount++;
                continue;
            }

            sources.push(...result.value.sources);
            subtitles.push(...result.value.subtitles);
        }

        if (failCount > 0 && sources.length > 0) {
            diagnostics.push({
                code: 'PARTIAL_SCRAPE',
                message: `${failCount} of ${PEACHIFY_SERVERS.length} peachify servers failed to respond`,
                field: '',
                severity: 'warning'
            });
        }

        if (sources.length === 0) {
            return this.emptyResult(
                'all peachify servers returned no sources',
                media
            );
        }

        return { sources, subtitles, diagnostics };
    }

    /**
     * hits a single peachify api server, handles decryption if needed,
     * and maps the raw response into the omss provider result shape.
     */
    private async fetchFromServer(
        serverBase: string,
        media: ProviderMediaObject
    ): Promise<ProviderResult | null> {
        const apiUrl = this.buildApiUrl(serverBase, media);
        const serverName = new URL(serverBase).hostname;

        const response = await fetch(apiUrl, { headers: this.HEADERS });

        if (!response.ok) return null;

        let body = (await response.json()) as PeachifyApiResponse;

        if (body.isEncrypted && body.data) {
            const decrypted = await this.decrypt(body.data, ENCRYPTION_KEY);
            if (!decrypted) return null;
            body = decrypted;
        }

        const rawSources = Array.isArray(body.sources) ? body.sources : [];
        const rawSubtitles = Array.isArray(body.subtitles)
            ? body.subtitles
            : [];

        if (rawSources.length === 0) return null;

        const parsed = rawSources
            .map((s) => this.parseSource(s, serverName))
            .filter((s): s is PeachifyParsedSource => s !== null);

        const parsedSubs = rawSubtitles
            .map((s) => this.parseSubtitle(s, serverName))
            .filter((s): s is PeachifyParsedSubtitle => s !== null);

        const sources: ProviderResult['sources'] = parsed.map((s) => ({
            url: this.createProxyUrl(s.url, s.headers ?? this.HEADERS),
            type: s.type,
            quality: s.quality ? `${s.quality}p` : 'unknown',
            audioTracks: [
                {
                    label: s.dub,
                    language: 'en'
                }
            ],
            provider: {
                id: this.id,
                name: this.name
            }
        }));

        const subtitles: ProviderResult['subtitles'] = parsedSubs.map((s) => ({
            url: this.createProxyUrl(s.url, this.HEADERS),
            label: s.label,
            format: 'vtt'
        }));

        return { sources, subtitles, diagnostics: [] };
    }

    /**
     * constructs the api path for a given server base url and media object.
     * tv paths append season and episode after the tmdb id.
     */
    private buildApiUrl(
        serverBase: string,
        media: ProviderMediaObject
    ): string {
        if (media.type === 'movie') {
            return `${serverBase}/movie/${media.tmdbId}`;
        }

        if (media.type === 'tv') {
            if (!media.s || !media.e) {
                throw new Error('missing season or episode number');
            }
            return `${serverBase}/tv/${media.tmdbId}/${media.s}/${media.e}`;
        }

        throw new Error(`unsupported media type: ${media.type}`);
    }

    /**
     * decrypts a peachify aes-gcm ciphertext string.
     * the payload format is: iv.tag.ciphertext — all url-safe base64 encoded.
     * the hex key is imported as a raw aes-gcm key via the web crypto api.
     */
    private async decrypt(
        payload: string,
        hexKey: string
    ): Promise<PeachifyApiResponse | null> {
        try {
            const decode = (b64url: string): Uint8Array => {
                const padded =
                    b64url.replace(/-/g, '+').replace(/_/g, '/') +
                    '='.repeat((4 - (b64url.length % 4)) % 4);
                const binary = atob(padded);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                return bytes;
            };

            const importKey = async (hex: string) => {
                const raw = new Uint8Array(
                    hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
                );
                return crypto.subtle.importKey(
                    'raw',
                    raw,
                    { name: 'AES-GCM' },
                    false,
                    ['decrypt']
                );
            };

            const [ivPart, tagPart, cipherPart] = payload.split('.');
            const iv = decode(ivPart);
            const tag = decode(tagPart);
            const cipher = decode(cipherPart);

            // web crypto expects the ghash tag appended to the ciphertext
            const combined = new Uint8Array(tag.length + cipher.length);
            combined.set(tag, 0);
            combined.set(cipher, tag.length);

            const key = await importKey(hexKey);
            const plaintext = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                combined
            );

            return JSON.parse(
                new TextDecoder().decode(plaintext)
            ) as PeachifyApiResponse;
        } catch {
            return null;
        }
    }

    /**
     * extracts a usable source from a raw peachify source object.
     * the provider uses several different field names for the same data
     * depending on the server, so we probe each known alias in priority order.
     */
    private parseSource(
        raw: PeachifyRawSource,
        providerName: string
    ): PeachifyParsedSource | null {
        const url = this.pickString(raw, [
            'url',
            'src',
            'file',
            'stream',
            'streamUrl',
            'playbackUrl'
        ]);
        if (!url) return null;

        const rawType = this.pickString(raw, [
            'type',
            'format',
            'container'
        ]).toLowerCase();
        const type: 'hls' | 'mp4' =
            rawType.includes('hls') ||
            rawType.includes('m3u8') ||
            url.toLowerCase().includes('.m3u8')
                ? 'hls'
                : 'mp4';

        const rawDub = this.pickString(raw, [
            'dub',
            'audio',
            'audioName',
            'audioLang',
            'language',
            'lang',
            'label',
            'name',
            'title'
        ]);
        const dub = this.normalizeDubLabel(rawDub);

        const quality = this.pickNumber(raw, [
            'quality',
            'resolution',
            'height',
            'res'
        ]);
        const sizeBytes = this.pickNumber(raw, ['sizeBytes', 'size', 'bytes']);

        // commented out i think it's better if we leave the quality to unknowm
        //     where the url itself is an opaque string there is no hint to know the quality unlike the mp4
        // const quality = this.pickNumber(raw, ['quality', 'resolution', 'height', 'res'])
        //     ?? this.inferQualityFromBandwidth(this.pickNumber(raw, ['bandwidth', 'bitrate', 'bw']));
        // const sizeBytes = this.pickNumber(raw, ['sizeBytes', 'size', 'bytes']);

        const rawHeaders =
            raw.headers ?? raw.header ?? raw.requestHeaders ?? raw.httpHeaders;
        const headers = this.normalizeHeaders(rawHeaders);

        return {
            url,
            dub,
            type,
            quality,
            sizeBytes,
            headers,
            provider: providerName
        };
    }

    /**
     * extracts subtitle data from a raw peachify subtitle entry.
     * returns null if no url is present.
     */
    private parseSubtitle(
        raw: PeachifyRawSubtitle,
        providerName: string
    ): PeachifyParsedSubtitle | null {
        const url = raw.url ?? raw.file ?? raw.src;
        if (!url) return null;

        const label = raw.label ?? raw.name ?? raw.language ?? 'Unknown';
        const lang = raw.langCode ?? raw.lang ?? raw.language;

        return { url, label, lang, display: label, provider: providerName };
    }

    /**
     * returns the first non-empty string value found among the given keys.
     */
    private pickString(obj: Record<string, unknown>, keys: string[]): string {
        for (const key of keys) {
            const val = obj[key];
            if (typeof val === 'string' && val.trim()) return val.trim();
        }
        return '';
    }

    /**
     * rough quality guess when the provider only gives us a bitrate.
     * thresholds are conservative — better to under-label than over-promise.
     */
    private inferQualityFromBandwidth(
        bps: number | undefined
    ): number | undefined {
        if (!bps) return undefined;
        if (bps >= 4_000_000) return 1080;
        if (bps >= 2_000_000) return 720;
        if (bps >= 800_000) return 480;
        if (bps >= 400_000) return 360;
        return undefined;
    }

    /**
     * returns the first finite numeric value found among the given keys.
     * also handles string fields that embed a resolution-like number (e.g. "1080p").
     */
    private pickNumber(
        obj: Record<string, unknown>,
        keys: string[]
    ): number | undefined {
        for (const key of keys) {
            const val = obj[key];
            if (typeof val === 'number' && Number.isFinite(val)) return val;
            if (typeof val === 'string' && val.trim()) {
                const match = val.match(/\d{3,4}/);
                if (match) return Number(match[0]);
                const parsed = Number(val);
                if (Number.isFinite(parsed)) return parsed;
            }
        }
        return undefined;
    }

    /**
     * maps peachify dub label aliases to a clean display string.
     * "dubbed" → "Dub", "subbed" → "Sub", anything else is title-cased as-is.
     */
    private normalizeDubLabel(raw: string): string {
        if (!raw.trim()) return 'Original';
        const lower = raw.trim().toLowerCase();
        if (lower === 'dubbed') return 'Dub';
        if (lower === 'subbed') return 'Sub';
        return raw.trim();
    }

    /**
     * converts a loosely-typed headers object into a clean Record<string, string>.
     * drops entries with empty keys or null/undefined values.
     */
    private normalizeHeaders(
        raw: Record<string, unknown> | undefined
    ): Record<string, string> | undefined {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            return undefined;
        const entries = Object.entries(raw)
            .filter(([k, v]) => k.trim().length > 0 && v != null)
            .map(([k, v]): [string, string] => [k, String(v)]);
        return entries.length ? Object.fromEntries(entries) : undefined;
    }

    private emptyResult(
        message: string,
        _media: ProviderMediaObject
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
}
