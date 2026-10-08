#include "iledger.h"
#include <jni.h>
#include <string>

static std::string utf8(JNIEnv *env, jstring value) {
    if (!value) return {};
    // Java modified UTF-8 cannot represent emoji correctly; use the UTF-8 encoder.
    auto string_class = env->FindClass("java/lang/String");
    auto method = env->GetMethodID(string_class, "getBytes", "(Ljava/lang/String;)[B");
    auto charset = env->NewStringUTF("UTF-8");
    auto bytes = static_cast<jbyteArray>(env->CallObjectMethod(value, method, charset));
    std::string result(env->GetArrayLength(bytes), '\0');
    env->GetByteArrayRegion(bytes, 0, static_cast<jsize>(result.size()), reinterpret_cast<jbyte *>(result.data()));
    env->DeleteLocalRef(bytes); env->DeleteLocalRef(charset); env->DeleteLocalRef(string_class);
    return result;
}
static jstring java_string(JNIEnv *env, const char *text) {
    const std::string value(text ? text : "");
    auto bytes = env->NewByteArray(static_cast<jsize>(value.size()));
    env->SetByteArrayRegion(bytes,0,static_cast<jsize>(value.size()),reinterpret_cast<const jbyte *>(value.data()));
    auto type = env->FindClass("java/lang/String");
    auto constructor = env->GetMethodID(type,"<init>","([BLjava/lang/String;)V");
    auto charset = env->NewStringUTF("UTF-8");
    auto result = static_cast<jstring>(env->NewObject(type,constructor,bytes,charset));
    env->DeleteLocalRef(bytes);env->DeleteLocalRef(type);env->DeleteLocalRef(charset);
    return result;
}
extern "C" JNIEXPORT jlong JNICALL Java_com_iledger_nativeapp_NativeCore_open(JNIEnv *env,jobject,jstring path,jstring seed) {
    return reinterpret_cast<jlong>(il_open(utf8(env,path).c_str(),utf8(env,seed).c_str()));
}
extern "C" JNIEXPORT jstring JNICALL Java_com_iledger_nativeapp_NativeCore_execute(JNIEnv *env,jobject,jlong handle,jstring request) {
    char *result=il_execute(reinterpret_cast<ILStore *>(handle),utf8(env,request).c_str());
    auto output=java_string(env,result);il_free(result);return output;
}
extern "C" JNIEXPORT jstring JNICALL Java_com_iledger_nativeapp_NativeCore_error(JNIEnv *env,jobject) {return java_string(env,il_last_error());}
extern "C" JNIEXPORT void JNICALL Java_com_iledger_nativeapp_NativeCore_close(JNIEnv *,jobject,jlong handle) {il_close(reinterpret_cast<ILStore *>(handle));}
