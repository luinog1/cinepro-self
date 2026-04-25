/***
 *  steps
 * 1.
 * ***/

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
            let sources = await this.fetchMovieSource(media);
            return {
                sources,
                subtitles: [],
                diagnostics: []
            };
        } catch (error) {
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
        return this.getSources(media);
    }

    /**
     * Main scraping logic
     */
    private async getSources(
        media: ProviderMediaObject
    ): Promise<ProviderResult> {
        try {
            return {
                sources: [
                    {
                        // this.createProxyUrl(pageUrl, this.HEADERS)
                        url: '',
                        quality: '1080p',
                        type: 'hls',
                        audioTracks: [
                            {
                                label: 'English',
                                language: 'eng'
                            }
                        ],
                        provider: {
                            name: this.name,
                            id: this.id
                        }
                    }
                ],
                subtitles: [],
                diagnostics: []
            };
        } catch (error) {
            return this.emptyResult(
                error instanceof Error
                    ? error.message
                    : 'Unknown provider error',
                media
            );
        }
    }

    async fetchMovieSource(media: ProviderMediaObject): Promise<Source[]> {
        // fetch movie api
        // https://popr.ink/api/vidnest?id={tmdb_id}&type=movie

        const servers = ['default', 'catflix'];
        for (const server of servers) {
            try {
                let movieRequest =
                    `${this.BASE_URL}/api/vidnest?id=${media.tmdbId}&type=movie` +
                    (server !== 'default' ? `&server=${server}` : '');
                let data = await axios.get<VidnestResponse>(movieRequest, {
                    headers: { ...this.HEADERS, Referer: `${this.BASE_URL}/` }
                });
                let response = data.data;
                let url = response?.results?.[0].streams?.[0].url;
                let quality = response?.results?.[0].streams?.[0].quality;
                let streamType = path.extname(new URL(url).pathname);
                if (!url) continue;
                return [
                    {
                        url,
                        type: streamType === 'mp4' ? 'mp4' : 'hls',
                        quality: quality || 'auto',
                        audioTracks: [],
                        provider: { name: this.name, id: this.id }
                    }
                ];
            } catch (error) {
                continue;
            }
        }
        return [];
    }

    async fetchMovieSubstitles(
        media: ProviderMediaObject
    ): Promise<Subtitle[]> {
        return [
            {
                url: 'string',
                label: 'string',
                format: 'vtt'
            }
        ];
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
