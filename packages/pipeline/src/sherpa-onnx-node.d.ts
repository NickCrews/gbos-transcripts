declare module 'sherpa-onnx-node' {
    // These are best guesses of the types/interfaces based on the usage in our codebase and the sherpa-onnx documentation. Please adjust as needed.
    export interface WaveForm {
        sampleRate: number;
        samples: Float32Array;
    }
    export function readWave(path: string): WaveForm;

    export interface Stream {
        acceptWaveform(options: WaveForm): void;
    };

    export interface OfflineRecognizerResult {
        text: string;
        tokens?: string[];
        timestamps?: number[];
        lang?: string;
        emotion?: string;
        event?: string;
    }

    export class OfflineRecognizer {
        constructor(config: unknown);
        createStream(): Stream;
        decode(stream: Stream): void;
        getResult(stream: Stream): OfflineRecognizerResult;
    }
}
