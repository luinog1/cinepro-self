// popr.provider.integration.test.ts
import { describe, it, expect } from 'vitest';
import { PoprProvider } from '../src/providers/popr/popr';

describe('PoprProvider.fetchMovieSource real API', () => {
    it('fetches real movie source from Popr API', async () => {
        const provider = new PoprProvider();

        const result = await provider.fetchMovieSource({
            tmdbId: '550' // Fight Club TMDB id
        } as any);

        console.log('REAL RESULT:');
        console.dir(result, { depth: null });

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].url).toBeTruthy();
        expect(result[0].provider.id).toBe('popr');
    });
});
