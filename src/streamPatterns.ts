// These regex patterns are used that the proxy can identify which urls should be streamed.
// by default the most common video files are included in the @omss/framework

export const streamPatterns: RegExp[] = [
    /pixeldrain.dev|pixeldra\.in/,
    /hub.raj.lat/,
    /hub.oreao-cdn.buzz/,
    /wasabisys.com/,
    /hakunaymatata.com/,
    /streamflixserver.site/,
    /tripplestream.online/,
];
