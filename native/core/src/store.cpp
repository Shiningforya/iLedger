#include "iledger.h"
#include "core.hpp"
#include "sqlite3.h"
#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <unordered_map>

using ledger::Json;
static thread_local std::string last_error;
static const char *collections[] = {"accounts", "categories", "creditTools", "transactions", "subscriptions", "assets", "repayments", "loans", "projectRules", "rates", "tiles"};

struct ILStore {
    sqlite3 *db = nullptr;
    Json state;
    std::mutex mutex;
    int64_t revision = 0;
    ~ILStore() { if (db) sqlite3_close_v2(db); }
};

namespace {
void sql(sqlite3 *db, const char *query) {
    char *error = nullptr;
    if (sqlite3_exec(db, query, nullptr, nullptr, &error) != SQLITE_OK) {
        std::string message = error ? error : sqlite3_errmsg(db);
        sqlite3_free(error);
        throw std::runtime_error(message);
    }
}

struct Statement {
    sqlite3_stmt *value = nullptr;
    explicit Statement(sqlite3 *db, const char *query) {
        if (sqlite3_prepare_v2(db, query, -1, &value, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(db));
    }
    ~Statement() { sqlite3_finalize(value); }
    void text(int index, const std::string &text) { sqlite3_bind_text(value, index, text.c_str(), -1, SQLITE_TRANSIENT); }
    void done() {
        if (sqlite3_step(value) != SQLITE_DONE) throw std::runtime_error(sqlite3_errmsg(sqlite3_db_handle(value)));
        sqlite3_reset(value); sqlite3_clear_bindings(value);
    }
};

std::string id_for(const char *collection, const Json &value) {
    return value.at(std::string(collection) == "rates" ? "code" : "id").get<std::string>();
}

void persist(ILStore &store, const Json &previous, const Json &next, bool keep_import_backup = false) {
    sql(store.db, "BEGIN IMMEDIATE");
    try {
        if (keep_import_backup) {
            Statement backup(store.db, "INSERT INTO metadata(key,value) VALUES('before_import',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
            backup.text(1, previous.dump()); backup.done();
        }
        Statement put(store.db, "INSERT INTO records(collection,id,position,payload) VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET position=excluded.position,payload=excluded.payload");
        Statement remove(store.db, "DELETE FROM records WHERE collection=? AND id=?");
        Json settings = next;
        for (const auto *collection : collections) {
            std::unordered_map<std::string, std::pair<int, std::string>> old;
            int old_position = 0;
            if (previous.contains(collection)) for (const auto &item : previous.at(collection)) old[id_for(collection, item)] = {old_position++, item.dump()};
            int position = 0;
            for (const auto &item : next.at(collection)) {
                const auto id = id_for(collection, item), payload = item.dump();
                // Position is part of persistence: reordering does not change the entity JSON.
                const auto previous_item = old.find(id);
                if (previous_item == old.end() || previous_item->second != std::make_pair(position, payload)) {
                    put.text(1, collection); put.text(2, id); sqlite3_bind_int(put.value, 3, position); put.text(4, payload); put.done();
                }
                position++;
                old.erase(id);
            }
            for (const auto &[id, unused] : old) { remove.text(1, collection); remove.text(2, id); remove.done(); }
            settings.erase(collection);
        }
        Statement meta(store.db, "INSERT INTO metadata(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
        meta.text(1, settings.dump()); meta.done();
        Statement revision(store.db, "INSERT INTO metadata(key,value) VALUES('revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
        revision.text(1, std::to_string(store.revision + 1)); revision.done();
        sql(store.db, "COMMIT");
        store.revision++;
    } catch (...) {
        sqlite3_exec(store.db, "ROLLBACK", nullptr, nullptr, nullptr);
        throw;
    }
}

char *response(const Json &value) {
    const auto text = value.dump();
    auto *buffer = static_cast<char *>(std::malloc(text.size() + 1));
    if (buffer) std::memcpy(buffer, text.c_str(), text.size() + 1);
    return buffer;
}
}

extern "C" ILStore *il_open(const char *path, const char *seed) {
    last_error.clear();
    try {
        if (!path || !seed) throw std::runtime_error("数据库路径与预设不能为空");
        auto store = std::make_unique<ILStore>();
        if (sqlite3_open_v2(path, &store->db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nullptr) != SQLITE_OK) throw std::runtime_error(sqlite3_errmsg(store->db));
        sqlite3_busy_timeout(store->db, 5000);
        {
            Statement version(store->db, "PRAGMA user_version");
            if (sqlite3_step(version.value) != SQLITE_ROW || sqlite3_column_int(version.value, 0) > 1) throw std::runtime_error("数据库来自更高版本，请先升级应用");
        }
        sql(store->db, "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
        sql(store->db, "CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records(collection TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(collection,id)); CREATE INDEX IF NOT EXISTS records_order ON records(collection,position); PRAGMA user_version=1;");
        Statement meta(store->db, "SELECT value FROM metadata WHERE key='settings'");
        if (sqlite3_step(meta.value) == SQLITE_ROW) {
            store->state = Json::parse(reinterpret_cast<const char *>(sqlite3_column_text(meta.value, 0)));
            for (const auto *collection : collections) store->state[collection] = Json::array();
            Statement records(store->db, "SELECT collection,payload FROM records ORDER BY collection,position");
            while (sqlite3_step(records.value) == SQLITE_ROW) {
                const std::string collection = reinterpret_cast<const char *>(sqlite3_column_text(records.value, 0));
                store->state[collection].push_back(Json::parse(reinterpret_cast<const char *>(sqlite3_column_text(records.value, 1))));
            }
            Statement revision(store->db, "SELECT value FROM metadata WHERE key='revision'");
            if (sqlite3_step(revision.value) == SQLITE_ROW) store->revision = std::stoll(reinterpret_cast<const char *>(sqlite3_column_text(revision.value, 0)));
            store->state = ledger::normalize(store->state);
            ledger::validate(store->state);
        } else {
            store->state = ledger::normalize(Json::parse(seed));
            ledger::validate(store->state);
            persist(*store, Json::object(), store->state);
        }
        return store.release();
    } catch (const std::exception &error) { last_error = error.what(); return nullptr; }
}

extern "C" const char *il_last_error() { return last_error.c_str(); }
extern "C" void il_close(ILStore *store) { delete store; }
extern "C" void il_free(char *value) { std::free(value); }
extern "C" char *il_execute(ILStore *store, const char *request_json) {
    if (!store || !request_json) return response({{"ok", false}, {"error", "数据库未打开"}});
    std::lock_guard<std::mutex> guard(store->mutex);
    try {
        auto request = Json::parse(request_json);
        if (request.contains("expectedRevision") && request.at("expectedRevision").get<int64_t>() != store->revision) throw std::runtime_error("数据已变更，请刷新后再保存");
        const auto action = request.at("action").get<std::string>();
        if (action == "snapshot") return response({{"ok", true}, {"data", store->state}, {"revision", store->revision}});
        if (action == "restoreImportBackup" || action == "hasImportBackup") {
            Statement backup(store->db, "SELECT value FROM metadata WHERE key='before_import'");
            const bool available = sqlite3_step(backup.value) == SQLITE_ROW;
            if (action == "hasImportBackup") return response({{"ok", true}, {"data", {{"available", available}}}, {"revision", store->revision}});
            if (!available) throw std::runtime_error("没有可撤销的导入");
            request = {{"action", "import"}, {"value", Json::parse(reinterpret_cast<const char *>(sqlite3_column_text(backup.value, 0)))}};
        }
        auto next = store->state;
        auto result = ledger::apply(next, request);
        if (next != store->state) {
            ledger::validate(next);
            persist(*store, store->state, next, action == "import" || action == "restoreImportBackup");
            store->state = std::move(next);
        }
        return response({{"ok", true}, {"data", result}, {"revision", store->revision}});
    } catch (const std::exception &error) { return response({{"ok", false}, {"error", error.what()}, {"revision", store->revision}}); }
}
