#include "sherpa-onnx/c-api/c-api.h"
#include <cstdio>
#include <string>

int main(int argc, char **argv) {
    if (argc != 3) { std::fprintf(stderr, "Usage: iledger-speech model-directory audio.wav\n"); return 2; }
    const auto model = std::string(argv[1]) + "/model.int8.onnx";
    const auto tokens = std::string(argv[1]) + "/tokens.txt";
    const auto *wave = SherpaOnnxReadWave(argv[2]);
    if (!wave) { std::fprintf(stderr, "Cannot read mono PCM WAV\n"); return 3; }
    SherpaOnnxOfflineRecognizerConfig config{};
    config.decoding_method = "greedy_search";
    config.model_config.num_threads = 2;
    config.model_config.provider = "cpu";
    config.model_config.tokens = tokens.c_str();
    config.model_config.sense_voice.model = model.c_str();
    config.model_config.sense_voice.language = "zh";
    config.model_config.sense_voice.use_itn = 1;
    const auto *recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
    if (!recognizer) { SherpaOnnxFreeWave(wave); std::fprintf(stderr, "Cannot load SenseVoice model\n"); return 4; }
    const auto *stream = SherpaOnnxCreateOfflineStream(recognizer);
    if (!stream) { SherpaOnnxDestroyOfflineRecognizer(recognizer); SherpaOnnxFreeWave(wave); std::fprintf(stderr, "Cannot create recognition stream\n"); return 4; }
    SherpaOnnxAcceptWaveformOffline(stream, wave->sample_rate, wave->samples, wave->num_samples);
    SherpaOnnxDecodeOfflineStream(recognizer, stream);
    const auto *result = SherpaOnnxGetOfflineStreamResult(stream);
    if (result && result->text) std::printf("%s\n", result->text);
    const int code = result && result->text && result->text[0] ? 0 : 5;
    if (result) SherpaOnnxDestroyOfflineRecognizerResult(result);
    SherpaOnnxDestroyOfflineStream(stream);
    SherpaOnnxDestroyOfflineRecognizer(recognizer);
    SherpaOnnxFreeWave(wave);
    return code;
}
