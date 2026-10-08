#include "core.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstring>
#include <iomanip>
#include <random>
#include <regex>
#include <set>
#include <sstream>
#include <stdexcept>

namespace ledger {
namespace {
const std::vector<std::string> collections = {"accounts", "categories", "creditTools", "transactions", "subscriptions", "assets", "repayments", "loans", "projectRules", "rates", "tiles"};
std::string str(const Json &j, const std::string &key, std::string fallback = "") { return j.contains(key) && j[key].is_string() ? j[key].get<std::string>() : fallback; }
double number(const Json &j, const std::string &key, double fallback = 0) { return j.contains(key) && j[key].is_number() ? j[key].get<double>() : fallback; }
bool flag(const Json &j, const std::string &key, bool fallback = false) { return j.contains(key) && j[key].is_boolean() ? j[key].get<bool>() : fallback; }
void require(bool condition, const std::string &message) { if (!condition) throw std::runtime_error(message); }
std::string uid() {
    static thread_local std::mt19937_64 generator(std::random_device{}());
    std::ostringstream value; value << std::hex << std::setfill('0') << std::setw(16) << generator() << std::setw(16) << generator();
    return value.str();
}
Json *find(Json &items, const std::string &id, const char *key = "id") { for (auto &item : items) if (str(item, key) == id) return &item; return nullptr; }
const Json *find(const Json &items, const std::string &id, const char *key = "id") { for (const auto &item : items) if (str(item, key) == id) return &item; return nullptr; }
void upsert(Json &items, Json value, const char *key = "id") { if (auto *old = find(items, str(value, key), key)) *old = std::move(value); else items.push_back(std::move(value)); }
void erase(Json &items, const std::string &id, const char *key = "id") { items.erase(std::remove_if(items.begin(), items.end(), [&](const auto &item) { return str(item, key) == id; }), items.end()); }
std::string lower(std::string value) { for (auto &c : value) if (static_cast<unsigned char>(c) < 128) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c))); return value; }
bool valid_date(const std::string &value) {
    if (!std::regex_match(value, std::regex(R"(\d{4}-\d{2}-\d{2})"))) return false;
    const int year = std::stoi(value.substr(0, 4)), month = std::stoi(value.substr(5, 2)), day = std::stoi(value.substr(8, 2));
    static const int days[] = {31,28,31,30,31,30,31,31,30,31,30,31};
    return year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= days[month-1] + (month == 2 && year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
}
Json &account(Json &state, const std::string &id) {
    auto *value = find(state["accounts"], id); require(value != nullptr && !str(*value, "parentAccountId").empty(), "请选择有效的子账户"); return *value;
}
double base_amount(const Json &state, const Json &tx, const std::string &target) {
    if (str(tx, "bookedBaseCurrency") == target && tx.contains("amountInBase")) return number(tx, "amountInBase");
    if (str(tx, "currency") == target) return number(tx, "amount");
    return money(number(tx, "amountCny", number(tx, "amount") * rate(state, str(tx, "currency"))) / rate(state, target), target);
}
double balance_effect(const Json &state, const Json &tx, const Json &acc) {
    if (!flag(tx, "balanceApplied")) return 0;
    const auto currency = str(acc, "currency", "CNY");
    const double amount = str(tx, "accountCurrency") == currency && tx.contains("accountAmount") ? number(tx, "accountAmount") : base_amount(state, tx, currency);
    return str(tx, "type") == "income" ? amount : -amount;
}
void change_balance(Json &state, const Json &tx, int direction) {
    if (!flag(tx, "balanceApplied")) return;
    auto &acc = account(state, str(tx, "accountId"));
    acc["balance"] = money(number(acc, "balance") + direction * balance_effect(state, tx, acc), str(acc, "currency"));
}
std::string category_name(const Json &state, const std::string &id, const std::string &fallback) { const auto *cat = find(state["categories"], id); return cat ? str(*cat, "name") : fallback; }

Json book(Json &state, Json tx, const Json &old) {
    auto &acc = account(state, str(tx, "accountId"));
    require(number(tx, "amount") > 0 && std::isfinite(number(tx, "amount")), "金额必须大于零");
    require(!str(tx, "item").empty(), "请输入项目名称");
    require(valid_date(str(tx, "date")), "日期无效");
    require(str(tx, "type") == "expense" || str(tx, "type") == "income", "收支类型无效");
    const auto *category = find(state["categories"], str(tx, "category"), "name");
    require(category && str(*category, "type") == str(tx, "type"), "请选择对应收支类型的类别");
    const auto currency = str(tx, "currency", str(state, "baseCurrency"));
    const auto base = str(old, "bookedBaseCurrency", str(state, "baseCurrency"));
    require(find(state["rates"], currency, "code") && find(state["rates"], base, "code"), "币种不存在");
    const bool money_changed = old.is_null() || number(old, "amount") != number(tx, "amount") || str(old, "currency") != currency || number(old, "exchangeRateToBase") != number(tx, "exchangeRateToBase") || number(old, "amountInBase") != number(tx, "amountInBase");
    tx["currency"] = currency;
    if (money_changed) {
        const double fx = currency == base ? 1 : number(tx, "exchangeRateToBase", rate(state, currency) / rate(state, base));
        require(fx > 0 && std::isfinite(fx), "汇率必须大于零");
        const double converted = currency == base ? number(tx, "amount") : number(tx, "amount") * fx;
        tx["bookedBaseCurrency"] = base; tx["exchangeRateToBase"] = fx;
        tx["amountInBase"] = money(converted, base);
        tx["exchangeRateToCny"] = fx * rate(state, base); tx["amountCny"] = money(converted * rate(state, base), "CNY");
    }
    tx["status"] = str(tx, "status", "posted");
    tx["paymentKind"] = str(tx, "paymentKind", "normal");
    require(str(tx, "status") == "posted" || str(tx, "status") == "scheduled", "入账状态无效");
    if (str(tx, "paymentKind") != "normal") {
        const auto *tool = find(state["creditTools"], str(tx, "creditToolId"));
        require(tool && str(*tool, "accountId") == str(tx, "accountId"), "信用账户与子账户不匹配");
    }
    tx["balanceApplied"] = str(tx, "status") == "posted" && str(tx, "paymentKind") == "normal";
    if (money_changed || str(old, "accountId") != str(tx, "accountId") || !tx.contains("accountAmount")) {
        tx["accountCurrency"] = str(acc, "currency", "CNY");
        tx["accountAmount"] = base_amount(state, tx, str(acc, "currency", "CNY"));
    }
    return tx;
}

Json save_transaction(Json &state, Json draft) {
    if (str(draft, "id").empty()) draft["id"] = uid();
    const auto id = str(draft, "id");
    const auto *previous = find(state["transactions"], id);
    const Json old = previous ? *previous : Json();
    Json tx = old.is_null() ? Json::object() : old;
    tx.update(draft);
    if (!old.is_null() && str(old, "currency") != str(tx, "currency") && !draft.contains("exchangeRateToBase")) tx.erase("exchangeRateToBase");
    tx = book(state, tx, old);
    if (!old.is_null()) change_balance(state, old, -1);
    change_balance(state, tx, 1);
    for (const auto &kind : {std::string("subscription"), std::string("asset")}) {
        const std::string link = kind + "Id", collection = kind == "asset" ? "assets" : "subscriptions", toggle = kind == "asset" ? "trackDepreciation" : "isSubscription";
        const bool enabled = flag(draft, toggle, !str(tx, link).empty());
        if (!enabled) { if (!str(tx, link).empty()) erase(state[collection], str(tx, link)); tx.erase(link); }
        else {
            require(str(tx, "type") == "expense", "订阅与折旧只能关联支出");
            const auto linked_id = str(tx, link, id + "-" + kind);
            const auto *existing = find(state[collection], linked_id);
            Json item = existing ? *existing : Json::object();
            item.update({{"id", linked_id}, {"name", tx["item"]}, {"category", tx["category"]}, {"bookedBaseCurrency", tx["bookedBaseCurrency"]}});
            if (kind == "asset") {
                item.update({{"price", tx["amountInBase"]}, {"priceCny", tx["amountCny"]}, {"purchasedAt", tx["date"]}, {"lifeDays", number(draft, "assetLifeDays", number(item, "lifeDays", 1095))}});
            } else {
                item.update({{"amount", tx["amountInBase"]}, {"amountCny", tx["amountCny"]}, {"accountId", tx["accountId"]}, {"startedAt", tx["date"]}, {"cycle", str(draft, "subscriptionCycle", str(item, "cycle", "monthly"))}, {"renewalMode", str(draft, "subscriptionMode", str(item, "renewalMode", "fixed"))}, {"endsAt", str(draft, "subscriptionEndsAt", str(item, "endsAt", str(tx, "date")))}, {"reminderDays", number(draft, "subscriptionReminderDays", number(item, "reminderDays", 3))}});
                require(valid_date(str(item, "endsAt")) && str(item, "endsAt") >= str(item, "startedAt"), "订阅到期日不能早于开始日期");
            }
            upsert(state[collection], item); tx[link] = linked_id;
        }
        tx.erase(toggle);
    }
    if (str(tx, "type") == "income" && str(tx, "category") == category_name(state, "borrowing", "借款")) {
        const auto loan_id = str(tx, "loanId", id + "-loan");
        const auto *existing = find(state["loans"], loan_id);
        Json loan = existing ? *existing : Json::object();
        loan.update({{"id", loan_id}, {"transactionId", id}, {"name", tx["item"]}, {"principal", tx["amount"]}, {"currency", tx["currency"]}, {"accountId", tx["accountId"]}, {"borrowedAt", tx["date"]}, {"status", str(loan, "status", "outstanding")}});
        if (draft.contains("loanDueDate")) { require(str(draft, "loanDueDate").empty() || valid_date(str(draft, "loanDueDate")), "还款日期无效"); loan["dueDate"] = draft["loanDueDate"]; }
        upsert(state["loans"], loan); tx["loanId"] = loan_id;
    } else if (!str(tx, "loanId").empty()) {
        const auto *loan = find(state["loans"], str(tx, "loanId"));
        require(!loan || str(*loan, "status") != "repaid", "已归还借款请先撤销还款再变更类别");
        erase(state["loans"], str(tx, "loanId")); tx.erase("loanId");
    }
    if (!str(tx, "repaymentLoanId").empty()) {
        auto *loan = find(state["loans"], str(tx, "repaymentLoanId"));
        require(loan && (str(*loan, "status") == "outstanding" || str(*loan, "repaymentTransactionId") == id), "借款不存在或已归还");
        require(str(tx, "type") == "expense", "还款必须记录为支出");
        loan->update({{"status", "repaid"}, {"repaidAt", tx["date"]}, {"repaymentAccountId", tx["accountId"]}, {"repaymentTransactionId", id}});
    }
    upsert(state["transactions"], tx);
    return tx;
}

void delete_transaction(Json &state, const std::string &id) {
    const auto *found = find(state["transactions"], id); require(found != nullptr, "流水不存在");
    const Json tx = *found;
    change_balance(state, tx, -1);
    for (auto &loan : state["loans"]) if (str(loan, "repaymentTransactionId") == id) { loan["status"] = "outstanding"; loan.erase("repaidAt"); loan.erase("repaymentAccountId"); loan.erase("repaymentTransactionId"); }
    if (!str(tx, "loanId").empty()) {
        const auto *loan = find(state["loans"], str(tx, "loanId"));
        require(!loan || str(*loan, "status") != "repaid", "请先删除此借款对应的还款流水");
        erase(state["loans"], str(tx, "loanId"));
    }
    if (!str(tx, "subscriptionId").empty()) erase(state["subscriptions"], str(tx, "subscriptionId"));
    if (!str(tx, "assetId").empty()) erase(state["assets"], str(tx, "assetId"));
    erase(state["transactions"], id);
}
}

double money(double value, const std::string &currency) {
    require(std::isfinite(value) && std::abs(value) < 1e13, "金额超出支持范围");
    const int decimals = currency == "JPY" || currency == "KRW" || currency == "VND" ? 0 : currency == "KWD" || currency == "BHD" || currency == "OMR" ? 3 : 2;
    const double scale = std::pow(10.0, decimals);
    return std::round(value * scale) / scale;
}
double rate(const Json &state, const std::string &currency) {
    if (currency == "CNY") return 1;
    const auto *entry = find(state.at("rates"), currency, "code");
    require(entry && number(*entry, "rateToCny") > 0, "缺少 " + currency + " 的有效汇率");
    return number(*entry, "rateToCny");
}

Json normalize(Json state) {
    require(state.is_object(), "账本格式无效");
    for (const auto &key : collections) { if (!state.contains(key)) state[key] = Json::array(); require(state[key].is_array(), key + " 必须为列表"); }
    if (!state.contains("baseCurrency")) state["baseCurrency"] = "CNY";
    for (auto &acc : state["accounts"]) if (!str(acc, "parentAccountId").empty() && str(acc, "currency").empty()) acc["currency"] = "CNY";
    if (state.contains("webDav")) state["webDav"].erase("password");
    state["nativeSchemaVersion"] = 1;
    return state;
}

void validate(const Json &state) {
    for (const auto &collection : collections) {
        std::set<std::string> ids;
        for (const auto &value : state.at(collection)) {
            const auto id = str(value, collection == "rates" ? "code" : "id");
            require(!id.empty() && ids.insert(id).second, collection + " 存在空白或重复标识");
        }
    }
    require(find(state["rates"], str(state, "baseCurrency"), "code"), "本币未包含在汇率库中");
    for (const auto &acc : state["accounts"]) {
        require(!str(acc, "name").empty(), "账户名称不能为空");
        if (!str(acc, "parentAccountId").empty()) {
            const auto *parent = find(state["accounts"], str(acc, "parentAccountId"));
            require(parent && str(*parent, "parentAccountId").empty() && str(*parent, "id") != str(acc, "id"), "账户层级无效");
            require(find(state["rates"], str(acc, "currency"), "code"), "子账户币种不存在");
        }
    }
    for (const auto &tx : state["transactions"]) {
        const auto *acc = find(state["accounts"], str(tx, "accountId"));
        require(acc && !str(*acc, "parentAccountId").empty(), "流水引用了不存在的子账户");
        require(find(state["rates"], str(tx, "currency"), "code"), "流水币种不存在");
        require(number(tx, "amount") > 0 && valid_date(str(tx, "date")), "流水金额或日期无效");
        for (const auto &[key, collection] : std::vector<std::pair<std::string,std::string>>{{"subscriptionId","subscriptions"},{"assetId","assets"},{"loanId","loans"}}) if (!str(tx, key).empty()) require(find(state[collection], str(tx, key)), "流水关联内容不存在");
    }
    for (const auto &item : state["rates"]) require(number(item, "rateToCny") > 0 && std::isfinite(number(item, "rateToCny")), "汇率必须是正数");
}

Json parse_entry(const Json &state, const std::string &source, const std::string &date) {
    require(!source.empty(), "请输入记账内容");
    Json result = {{"source", source}, {"item", source}, {"type", "expense"}, {"currency", str(state, "baseCurrency")}, {"date", date}, {"paymentKind", "normal"}, {"status", "posted"}, {"amount", 0}, {"category", ""}, {"accountId", ""}};
    Json locks = Json::object();
    const auto text = lower(source);
    auto match = [&](const Json &items, const std::string &name_key, bool children_only) -> const Json * {
        const Json *best = nullptr; size_t score = 0;
        for (const auto &item : items) {
            if (children_only && str(item, "parentAccountId").empty()) continue;
            std::vector<std::string> aliases{str(item, name_key)};
            if (item.contains("aliases") && item["aliases"].is_array()) for (const auto &alias : item["aliases"]) if (alias.is_string()) aliases.push_back(alias.get<std::string>());
            for (const auto &alias : aliases) {
                const auto key = lower(alias);
                if (!key.empty() && text.find(key) != std::string::npos && key.size() > score) { best = &item; score = key.size(); }
            }
        }
        return best;
    };
    if (text.find("收入") != std::string::npos || text.find("收到") != std::string::npos || text.find("借入") != std::string::npos) { result["type"] = "income"; locks["type"] = "income"; }
    else if (text.find("花了") != std::string::npos || text.find("花费") != std::string::npos || text.find("支出") != std::string::npos) locks["type"] = "expense";
    Json candidates = Json::array();
    for (const auto &cat : state["categories"]) if (!locks.contains("type") || cat["type"] == locks["type"]) candidates.push_back(cat);
    if (const auto *cat = match(candidates, "name", false)) { result["category"] = (*cat)["name"]; result["type"] = (*cat)["type"]; locks["category"] = result["category"]; locks["type"] = result["type"]; }
    if (const auto *acc = match(state["accounts"], "name", true)) { result["accountId"] = (*acc)["id"]; locks["accountId"] = result["accountId"]; }
    Json currencies = state["rates"];
    for (auto &currency : currencies) {
        if (!currency.contains("aliases")) currency["aliases"] = Json::array();
        currency["aliases"].push_back(currency["code"]);
        const auto code = str(currency, "code");
        for (const auto &alias : code == "USD" ? std::vector<std::string>{"美刀","美元","美金"} : code == "EUR" ? std::vector<std::string>{"欧元","欧"} : code == "IDR" ? std::vector<std::string>{"印尼盾","印度尼西亚卢比"} : std::vector<std::string>{}) currency["aliases"].push_back(alias);
    }
    if (const auto *currency = match(currencies, "name", false)) { result["currency"] = (*currency)["code"]; locks["currency"] = result["currency"]; }
    // A currency next to the amount outranks currency words inside account names.
    size_t currency_score = 0;
    for (const auto &currency : currencies) for (const auto &alias : currency["aliases"]) {
        if (!alias.is_string()) continue;
        const auto word = alias.get<std::string>(); if (word.empty()) continue;
        std::string escaped;
        for (char c : word) { if (std::strchr(".^$|()[]{}*+?\\", c)) escaped += '\\'; escaped += c; }
        const std::regex adjacent("(?:[0-9]+(?:\\.[0-9]+)?\\s*" + escaped + "|" + escaped + "\\s*[0-9]+(?:\\.[0-9]+)?)",std::regex::icase);
        if (word.size() > currency_score && std::regex_search(source,adjacent)) { result["currency"] = currency["code"]; locks["currency"] = result["currency"]; currency_score = word.size(); }
    }
    std::smatch amount;
    const std::regex explicit_amount(R"((?:花了|花费了|花费|支付|支出|收入|收到|收款|金额|借到|借入)[^0-9]{0,12}([0-9]+(?:\.[0-9]+)?))");
    if (std::regex_search(source, amount, explicit_amount)) result["amount"] = std::stod(amount[1]);
    else {
        const std::regex pattern(R"(([0-9]+(?:\.[0-9]+)?)\s*(?:人民币|美元|美金|美刀|欧元|印尼盾|日元|元|块|欧|CNY|USD|EUR|JPY|SGD|IDR))", std::regex::icase);
        if (std::regex_search(source, amount, pattern)) result["amount"] = std::stod(amount[1]);
        else { const std::regex numeric(R"(([0-9]+(?:\.[0-9]+)?))"); for (std::sregex_iterator it(source.begin(), source.end(), numeric), end; it != end; ++it) { amount = *it; result["amount"] = std::stod(amount[1]); } }
    }
    std::string item = source;
    if (!amount.empty()) item.erase(static_cast<size_t>(amount.position()), static_cast<size_t>(amount.length()));
    for (const auto &collection : {state["accounts"], currencies}) for (const auto &entry : collection) {
        std::vector<std::string> aliases{str(entry, "name"),str(entry,"code")};
        if (entry.contains("aliases")) for (const auto &alias : entry["aliases"]) if (alias.is_string()) aliases.push_back(alias.get<std::string>());
        for (const auto &alias : aliases) if (!alias.empty()) { auto pos = lower(item).find(lower(alias)); if (pos != std::string::npos) item.erase(pos, alias.size()); }
    }
    for (const auto &word : {"购买", "买了", "支出", "收入", "收到", "花了", "花费了", "花费", "账户为", "支付", "，", ",", "。"}) { size_t pos; while ((pos = item.find(word)) != std::string::npos) item.erase(pos, std::strlen(word)); }
    item = std::regex_replace(item, std::regex(R"(^\s+|\s+$)"), "");
    if (!item.empty()) result["item"] = item;
    if (const auto *rule = match(state["projectRules"], "keyword", false)) { result["item"] = (*rule)["item"]; locks["item"] = result["item"]; }
    if (str(result, "category").empty()) for (const auto &cat : state["categories"]) if (str(cat, "type") == str(result, "type")) { result["category"] = cat["name"]; break; }
    if (str(result, "accountId").empty()) for (const auto &acc : state["accounts"]) if (!str(acc, "parentAccountId").empty() && str(acc, "currency") == str(state, "baseCurrency")) { result["accountId"] = acc["id"]; break; }
    for (const auto &tool : state["creditTools"]) if (str(tool, "accountId") == str(result, "accountId")) { result["paymentKind"] = "credit"; result["creditToolId"] = tool["id"]; }
    result["recognitionLocks"] = locks;
    return result;
}

Json apply(Json &state, const Json &request) {
    const auto action = str(request, "action");
    Json value = request.value("value", Json::object());
    if (action == "import") { auto imported = normalize(value); validate(imported); state = std::move(imported); return {{"imported", state["transactions"].size()}}; }
    if (action == "parse") return parse_entry(state, str(request, "text"), str(request, "date"));
    if (action == "resolveModel") {
        Json result = parse_entry(state, str(request, "text"), str(request, "date"));
        const auto locks = result["recognitionLocks"];
        for (const auto *key : {"item", "type", "currency", "category", "accountId"}) if (value.contains(key) && value[key].is_string() && !locks.contains(key)) result[key] = value[key];
        if (number(result, "amount") <= 0 && number(value,"amount") > 0) result["amount"] = value["amount"];
        require(str(result,"type")=="income" || str(result,"type")=="expense", "模型返回无效收支类型");
        const auto *category=find(state["categories"],str(result,"category"),"name");
        require(category && str(*category,"type")==str(result,"type"),"模型返回了识别库之外的类别");
        require(find(state["rates"],str(result,"currency"),"code"),"模型返回了识别库之外的币种");
        account(state,str(result,"accountId"));
        result["paymentKind"]="normal";result.erase("creditToolId");
        for(const auto &tool:state["creditTools"])if(str(tool,"accountId")==str(result,"accountId")&&str(result,"type")=="expense"){result["paymentKind"]="credit";result["creditToolId"]=tool["id"];}
        return result;
    }
    if (action == "saveTransaction") return save_transaction(state, value);
    if (action == "deleteTransaction") { delete_transaction(state, str(request, "id")); return Json::object(); }
    if (action == "query") {
        const auto collection = str(request, "collection", "transactions");
        require(std::find(collections.begin(), collections.end(), collection) != collections.end(), "列表类型无效");
        Json rows = Json::array();
        for (const auto &item : state[collection]) if ((str(request,"type").empty() || str(item,"type") == str(request,"type")) && (str(request,"search").empty() || lower(item.dump()).find(lower(str(request,"search"))) != std::string::npos)) rows.push_back(item);
        if (collection == "transactions") std::stable_sort(rows.begin(), rows.end(), [](const auto &a, const auto &b) { return str(a,"date") > str(b,"date"); });
        const int size = std::clamp(static_cast<int>(number(request,"pageSize",20)), 1, 100), count = std::max(1, static_cast<int>((rows.size() + size - 1) / size));
        const int page = std::clamp(static_cast<int>(number(request,"page",1)), 1, count);
        Json output = Json::array();
        for (int i = (page-1)*size; i < std::min(static_cast<int>(rows.size()), page*size); i++) output.push_back(rows[i]);
        return {{"items",output},{"total",rows.size()},{"page",page},{"pageCount",count}};
    }
    if (action == "summary") {
        const auto currency = str(request,"currency",str(state,"baseCurrency")), year = str(request,"year"), month = str(request,"month");
        double expense=0, income=0; Json months=Json::array(), categories=Json::object();
        for(int i=1;i<=12;i++) months.push_back({{"month",i},{"income",0.0},{"expense",0.0},{"net",0.0}});
        for(const auto &tx:state["transactions"]) {
            if(str(tx,"status") == "scheduled") continue;
            const auto date=str(tx,"date"); if(!year.empty() && date.substr(0,4)!=year) continue;
            const auto type=str(tx,"type"); const double amount=base_amount(state,tx,currency);
            const int index=std::stoi(date.substr(5,2))-1;
            months[index][type]=number(months[index],type)+amount; months[index]["net"]=number(months[index],"income")-number(months[index],"expense");
            if(!month.empty() && date.substr(0,7)!=month) continue;
            if(type=="expense") {expense+=amount;const auto name=str(tx,"category");categories[name]=categories.value(name,0.0)+amount;} else income+=amount;
        }
        return {{"currency",currency},{"expense",money(expense,currency)},{"income",money(income,currency)},{"net",money(income-expense,currency)},{"months",months},{"categories",categories}};
    }
    if(action == "saveAccount") {
        if(str(value,"id").empty()) value["id"]=uid();
        require(!str(value,"name").empty(),"请输入账户名称");
        const auto *old=find(state["accounts"],str(value,"id"));
        if(old) {Json merged=*old;merged.update(value);value=std::move(merged);}
        if(old && str(*old,"currency")!=str(value,"currency")) for(const auto &tx:state["transactions"]) require(str(tx,"accountId")!=str(value,"id"),"已有流水的子账户不能直接改变币种，请新建子账户");
        if(!value.contains("balance")) value["balance"]=0;
        if(!value.contains("color")) value["color"]="#6D9E8A";
        if(!str(value,"parentAccountId").empty()) {
            const auto *parent=find(state["accounts"],str(value,"parentAccountId")); require(parent && str(*parent,"parentAccountId").empty(),"请选择主账户");
            if(str(value,"currency").empty()) value["currency"]=str(state,"baseCurrency");
        } else {
            value.erase("currency"); value["balance"]=0;
            if(!old) {
                Json child=request.value("initialChild",Json::object()); require(!str(child,"name").empty(),"新建主账户时请创建首个子账户");
                child["id"]=str(child,"id",uid()); child["parentAccountId"]=value["id"]; child["currency"]=str(child,"currency",str(state,"baseCurrency")); child["balance"]=number(child,"balance"); child["color"]=str(child,"color",str(value,"color")); upsert(state["accounts"],child);
            }
        }
        upsert(state["accounts"],value);
        if(request.contains("credit")) {
            Json credit=request["credit"];
            if(!credit.is_null()) {
                for(const auto &existing:state["creditTools"])if(str(existing,"accountId")==str(value,"id")){Json merged=existing;merged.update(credit);credit=std::move(merged);break;}
                require(!str(value,"parentAccountId").empty(),"信用能力只能配置在子账户");
                require(number(credit,"statementDay")>=1 && number(credit,"statementDay")<=31 && number(credit,"repaymentDay")>=1 && number(credit,"repaymentDay")<=31,"账单日或还款日无效");
                credit["id"]=str(credit,"id",str(value,"id")+"-credit"); credit["accountId"]=value["id"]; credit["parentAccountId"]=value["parentAccountId"]; credit["name"]=value["name"]; upsert(state["creditTools"],credit);
            } else { for(const auto &tool:state["creditTools"]) if(str(tool,"accountId")==str(value,"id")) for(const auto &tx:state["transactions"]) require(str(tx,"creditToolId")!=str(tool,"id"),"此信用账户仍有关联流水"); state["creditTools"].erase(std::remove_if(state["creditTools"].begin(),state["creditTools"].end(),[&](const auto &tool){return str(tool,"accountId")==str(value,"id");}),state["creditTools"].end()); }
        }
        return value;
    }
    if(action == "deleteAccount") {
        const auto id=str(request,"id"), target=str(request,"targetAccountId"); const auto *found=find(state["accounts"],id); require(found,"账户不存在"); const Json old=*found;
        for(const auto &acc:state["accounts"]) require(str(acc,"parentAccountId")!=id,"请先转移或删除所有子账户");
        if(!str(old,"parentAccountId").empty()) {
            require(target!=id,"请选择其他子账户"); auto &next=account(state,target);
            require(str(next,"currency")==str(old,"currency"),"流水转移目标需使用相同币种"); next["balance"]=money(number(next,"balance")+number(old,"balance"),str(next,"currency"));
            for(const auto &collection:{"transactions","subscriptions","repayments","loans"}) for(auto &item:state[collection]) for(const auto &key:{"accountId","repaymentAccountId"}) if(str(item,key)==id)item[key]=target;
            for(auto &tool:state["creditTools"]) { if(str(tool,"accountId")==id) { tool["accountId"]=target; tool["parentAccountId"]=next["parentAccountId"]; } if(str(tool,"repaymentAccountId")==id)tool["repaymentAccountId"]=target; if(tool.contains("repaymentAccountIds"))for(auto &ref:tool["repaymentAccountIds"])if(ref==id)ref=target; }
        }
        erase(state["accounts"],id);return Json::object();
    }
    if(action == "saveCategory") {
        if(str(value,"id").empty())value["id"]=uid(); require(!str(value,"name").empty(),"请输入类别名称");
        for(const auto &cat:state["categories"])require(str(cat,"name")!=str(value,"name")||str(cat,"id")==str(value,"id"),"类别名称已存在");
        const auto *old=find(state["categories"],str(value,"id"));
        if(old) { const auto before=str(*old,"name"); for(const auto &collection:{"transactions","subscriptions","assets","projectRules"})for(auto &item:state[collection])if(str(item,"category")==before) { require(str(value,"type")==str(*old,"type"),"已使用的类别不能改变收支类型"); item["category"]=value["name"]; } }
        upsert(state["categories"],value);return value;
    }
    if(action == "saveRate") { require(number(value,"rateToCny")>0,"汇率必须大于零"); require(str(value,"code")!="CNY"||number(value,"rateToCny")==1,"汇率基准不可改变");upsert(state["rates"],value,"code");return value; }
    if(action == "settings") {
        if(value.contains("baseCurrency")&&value["baseCurrency"]!=state["baseCurrency"]) {bool found=false;for(const auto &acc:state["accounts"])if(!str(acc,"parentAccountId").empty()&&acc.value("currency",Json())==value["baseCurrency"])found=true;require(found,"请先创建对应本币的子账户");}
        for(const auto &[key,setting]:value.items()) { require(std::find(collections.begin(),collections.end(),key)==collections.end(),"设置不能修改业务数据");state[key]=setting; }
        if(state.contains("webDav"))state["webDav"].erase("password");return value;
    }
    if(action == "saveManaged") {
        const auto collection=str(request,"collection");require(collection=="subscriptions"||collection=="assets"||collection=="loans","管理类型无效");
        const auto *old=find(state[collection],str(value,"id"));require(old,"记录不存在");
        const auto link=collection=="subscriptions"?"subscriptionId":collection=="assets"?"assetId":"loanId";
        Json linked=Json::array();for(const auto &tx:state["transactions"])if(str(tx,link)==str(value,"id"))linked.push_back(tx);
        for(auto tx:linked) {
            tx["item"]=value["name"];
            if(value.contains("category"))tx["category"]=value["category"];
            if(value.contains("accountId"))tx["accountId"]=value["accountId"];
            tx["date"]=value[collection=="subscriptions"?"startedAt":collection=="assets"?"purchasedAt":"borrowedAt"];
            if(collection=="loans") {tx["amount"]=value["principal"];tx["currency"]=value["currency"];tx["loanDueDate"]=str(value,"dueDate");}
            else { const double amount=number(value,collection=="assets"?"price":"amount");if(str(tx,"currency")==str(tx,"bookedBaseCurrency"))tx["amount"]=amount;tx["exchangeRateToBase"]=amount/number(tx,"amount");tx["amountInBase"]=amount; }
            if(collection=="subscriptions"){tx["subscriptionEndsAt"]=value["endsAt"];tx["subscriptionCycle"]=value["cycle"];tx["subscriptionMode"]=value["renewalMode"];}
            if(collection=="assets")tx["assetLifeDays"]=number(value,"lifeDays",1095);
            save_transaction(state,tx);
        }
        if (linked.empty()) { upsert(state[collection],value); return value; }
        return *find(state[collection],str(value,"id"));
    }
    if(action == "saveRule") {if(str(value,"id").empty())value["id"]=uid();require(!str(value,"keyword").empty()&&!str(value,"item").empty(),"识别关键词与项目名称不能为空");upsert(state["projectRules"],value);return value;}
    if(action == "saveTile") {if(str(value,"id").empty())value["id"]=uid();upsert(state["tiles"],value);return value;}
    if(action == "deleteEntity") {
        const auto collection=str(request,"collection"),id=str(request,"id");
        require(collection=="subscriptions"||collection=="assets"||collection=="projectRules"||collection=="tiles"||collection=="categories"||collection=="rates","此数据需要专用删除操作");
        const auto *old=find(state[collection],id,collection=="rates"?"code":"id");require(old,"记录不存在");
        if(collection=="categories")for(const auto &key:{"transactions","subscriptions","assets"})for(const auto &item:state[key])require(str(item,"category")!=str(*old,"name"),"此类别仍被使用，请先调整关联记录");
        if(collection=="rates") {require(id!=str(state,"baseCurrency")&&id!="CNY","不能删除本币或汇率基准");for(const auto &key:{"accounts","transactions","subscriptions","assets","loans","repayments"})for(const auto &item:state[key])require(str(item,"currency")!=id&&str(item,"bookedBaseCurrency")!=id,"此币种仍被历史记录使用");}
        if(collection=="subscriptions"||collection=="assets")for(auto &tx:state["transactions"]){const auto link=collection=="assets"?"assetId":"subscriptionId";if(str(tx,link)==id)tx.erase(link);}
        erase(state[collection],id,collection=="rates"?"code":"id");return Json::object();
    }
    throw std::runtime_error("不支持的账本操作："+action);
}
}
