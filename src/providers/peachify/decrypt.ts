import { PeachifyApiResponse } from './peachify.types.js';

/**
 * aes-gcm decryption key used by peachify for encrypted api responses.
 * this is embedded in their frontend bundle.
 */
const KEY =
    'ZDhmMmExYjVlOWM0NzA4MTRmNmIyYzNhNWQ4ZTdmOTAxYTJiM2M0ZDVlM2Y3YThiOWMwZDFlMmYzYTRiNWM2ZA==';

/**
 * decrypts a peachify aes-gcm ciphertext string.
 * the payload format is: iv.tag.ciphertext — all url-safe base64 encoded.
 * the hex key is imported as a raw aes-gcm key via the web crypto api.
 */
export default async function decrypt(
    payload: string
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

        const key = await importKey(Buffer.from(KEY, 'base64').toString());
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
