package com.iledger.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Iterator;
import java.util.Set;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;
import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.ResponseBody;

@CapacitorPlugin(name = "LedgerWebDav")
public class WebDavPlugin extends Plugin {
    private static final Set<String> METHODS = Set.of("PROPFIND", "MKCOL", "GET", "PUT");
    private static final String KEY_ALIAS = "iledger-webdav-login";
    private static final String LOGIN_PREFS = "iledger-webdav-auth";
    private final OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).build();

    private SharedPreferences loginPreferences() {
        return getContext().getSharedPreferences(LOGIN_PREFS, 0);
    }

    private SecretKey loginKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    @PluginMethod
    public void saveCredentials(PluginCall call) {
        String provider = call.getString("provider");
        String endpoint = call.getString("endpoint");
        String username = call.getString("username");
        String password = call.getString("password");
        if (provider == null || endpoint == null || username == null || password == null || password.isEmpty()) {
            call.reject("WebDAV 登录资料无效");
            return;
        }
        try {
            JSONObject login = new JSONObject();
            login.put("provider", provider);
            login.put("endpoint", endpoint);
            login.put("username", username);
            login.put("password", password);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, loginKey());
            byte[] encrypted = cipher.doFinal(login.toString().getBytes(StandardCharsets.UTF_8));
            boolean saved = loginPreferences().edit()
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putString("data", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .commit();
            if (!saved) {
                call.reject("无法保存 WebDAV 登录资料");
                return;
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("无法安全保存 WebDAV 登录：" + error.getMessage());
        }
    }

    @PluginMethod
    public void loadCredentials(PluginCall call) {
        String iv = loginPreferences().getString("iv", null);
        String data = loginPreferences().getString("data", null);
        if (iv == null || data == null) { call.resolve(new JSObject()); return; }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, loginKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            String json = new String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), StandardCharsets.UTF_8);
            JSObject result = new JSObject();
            result.put("credentials", new JSObject(json));
            call.resolve(result);
        } catch (Exception error) {
            loginPreferences().edit().clear().commit();
            call.reject("WebDAV 登录已失效，请重新登录");
        }
    }

    @PluginMethod
    public void clearCredentials(PluginCall call) {
        if (loginPreferences().edit().clear().commit()) call.resolve();
        else call.reject("无法清除 WebDAV 登录资料");
    }

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        String method = call.getString("method");
        String body = call.getString("body");
        if (url == null || method == null || !METHODS.contains(method)) {
            call.reject("WebDAV 请求不受支持");
            return;
        }
        try {
            String scheme = new URI(url).getScheme();
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) {
                call.reject("WebDAV 地址必须使用 HTTP 或 HTTPS");
                return;
            }
            Request.Builder builder = new Request.Builder().url(url);
            JSObject headers = call.getObject("headers");
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String key = keys.next();
                    String value = headers.getString(key);
                    if (value != null) builder.header(key, value);
                }
            }
            MediaType contentType = MediaType.parse(headers != null ? headers.optString("Content-Type", "application/octet-stream") : "application/octet-stream");
            RequestBody requestBody = body == null ? null : RequestBody.create(body, contentType);
            builder.method(method, requestBody);
            client.newCall(builder.build()).enqueue(new Callback() {
                @Override
                public void onFailure(Call request, IOException error) {
                    call.reject("WebDAV 网络请求失败：" + error.getMessage());
                }

                @Override
                public void onResponse(Call request, Response response) {
                    try (Response result = response) {
                        ResponseBody responseBody = result.body();
                        JSObject output = new JSObject();
                        output.put("status", result.code());
                        output.put("body", responseBody == null ? "" : responseBody.string());
                        call.resolve(output);
                    } catch (IOException error) {
                        call.reject("WebDAV 响应读取失败：" + error.getMessage());
                    }
                }
            });
        } catch (Exception error) {
            call.reject("WebDAV 请求无效：" + error.getMessage());
        }
    }
}
