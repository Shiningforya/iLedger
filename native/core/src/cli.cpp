#include "iledger.h"
#include <fstream>
#include <iostream>
#include <sstream>

int main(int argc, char **argv) {
    if (argc != 3) { std::cerr << "Usage: iledger-core database.sqlite presets.json\n"; return 2; }
    std::ifstream file(argv[2]); std::ostringstream buffer; buffer << file.rdbuf();
    if (!file) { std::cerr << "Cannot read presets\n"; return 2; }
    ILStore *store = il_open(argv[1], buffer.str().c_str());
    if (!store) { std::cerr << il_last_error() << '\n'; return 1; }
    std::string request;
    while (std::getline(std::cin, request)) {
        char *result = il_execute(store, request.c_str());
        if (!result) { il_close(store); return 1; }
        std::cout << result << std::endl; il_free(result);
    }
    il_close(store);
}
