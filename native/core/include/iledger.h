#ifndef ILEDGER_H
#define ILEDGER_H

#ifdef _WIN32
#ifdef ILEDGER_CORE_BUILD
#define IL_API __declspec(dllexport)
#else
#define IL_API __declspec(dllimport)
#endif
#else
#define IL_API __attribute__((visibility("default")))
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ILStore ILStore;
IL_API ILStore *il_open(const char *database_path, const char *seed_json);
IL_API const char *il_last_error(void);
IL_API char *il_execute(ILStore *store, const char *request_json);
IL_API void il_free(char *response);
IL_API void il_close(ILStore *store);

#ifdef __cplusplus
}
#endif
#endif
