#pragma once
#include "json.hpp"
#include <string>

namespace ledger {
using Json = nlohmann::json;
Json normalize(Json state);
void validate(const Json &state);
Json apply(Json &state, const Json &request);
Json parse_entry(const Json &state, const std::string &source, const std::string &date);
double rate(const Json &state, const std::string &currency);
double money(double amount, const std::string &currency);
}
