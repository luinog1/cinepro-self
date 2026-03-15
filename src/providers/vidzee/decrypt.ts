import type { StreamUrl } from './vidzee.types.js';

const KEY = "YWxvb2tlcGFyYXRoZXdpdGhsYXNzaQ==";

export default async function decrypt(
    urls: StreamUrl[]
): Promise<string[]> {
    const results: string[] = [];

    try {
        for (const streamurl of urls) {
            // atob(e)
            const decoded = Buffer.from(streamurl.link, "base64").toString("utf8");

            const [ivBase64, cipherBase64] = decoded.split(":");
            if (!ivBase64 || !cipherBase64) continue;

            // Base64.parse(a)
            const iv = Buffer.from(ivBase64, "base64");

            // ciphertext
            const ciphertext = Buffer.from(cipherBase64, "base64");

            // key.padEnd(32, "\0")
            const paddedKey = Buffer.from(KEY, "base64").toString().padEnd(32, "\0");
            const keyBytes = new TextEncoder().encode(paddedKey);

            const cryptoKey = await crypto.subtle.importKey(
                "raw",
                keyBytes,
                { name: "AES-CBC" },
                false,
                ["decrypt"]
            );

            const decryptedBuffer = await crypto.subtle.decrypt(
                {
                    name: "AES-CBC",
                    iv
                },
                cryptoKey,
                ciphertext
            );

            const decrypted = new TextDecoder().decode(decryptedBuffer).trim();

            if (decrypted) results.push(decrypted);
        }

        return results;
    } catch (error) {
        throw new Error("Vidzee Decrypt failed: " + (error as Error).message);
    }
}