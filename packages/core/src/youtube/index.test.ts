import { describe, it, expect } from "vitest";
import { videosInChannel, downloadVideoAudio } from ".";

describe("YouTube Module", () => {
    it("should fetch videos in a channel", () => {
        const sampleChannel = "UCOUlNInprZEjhbpVPiJOlEA"; // GBOS YouTube channel ID
        const videos = videosInChannel(sampleChannel);
        expect(videos).toBeInstanceOf(Array);
        expect(videos.length).toBeGreaterThan(0);
        expect(videos[0]).toHaveProperty("id");
        expect(videos[0]).toHaveProperty("title");
    });

    it("should download video audio", () => {
        // A 10sec video for testing
        const sampleVideo = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
        const path = (new URL("./test_audio/rick.wav", import.meta.url)).pathname;
        let result = downloadVideoAudio(sampleVideo, path, "overwrite");
        expect(result).toHaveProperty("downloaded", true);
        let result2 = downloadVideoAudio(sampleVideo, path, "skip");
        expect(result2).toHaveProperty("downloaded", false);
    });
});