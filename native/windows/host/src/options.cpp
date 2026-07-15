#include "options.h"

#include <windows.h>

#include <cstdio>
#include <vector>

namespace {

std::wstring ReadReg(const wchar_t* path, const wchar_t* name, const std::wstring& def) {
    wchar_t buf[256];
    DWORD size = sizeof(buf);
    LSTATUS rc = RegGetValueW(HKEY_CURRENT_USER, path, name, RRF_RT_REG_SZ, nullptr, buf, &size);
    return rc == ERROR_SUCCESS ? std::wstring(buf) : def;
}

void WriteReg(const wchar_t* path, const wchar_t* name, const std::wstring& value) {
    RegSetKeyValueW(HKEY_CURRENT_USER, path, name, REG_SZ, value.c_str(),
                    static_cast<DWORD>((value.size() + 1) * sizeof(wchar_t)));
}

bool ReadFlag(const wchar_t* path, const wchar_t* name, bool def) {
    return ReadReg(path, name, def ? L"on" : L"off") == L"on";
}

std::wstring OnOff(bool b) { return b ? L"on" : L"off"; }

// Value charset for scene/preset slugs coming back from settings.html.
bool IsSlug(const std::wstring& v) {
    if (v.empty() || v.size() > 64) return false;
    for (wchar_t c : v) {
        bool ok = (c >= L'a' && c <= L'z') || (c >= L'0' && c <= L'9') || c == L'-';
        if (!ok) return false;
    }
    return true;
}

}  // namespace

std::wstring EscapeDataString(const std::wstring& value) {
    int len = WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::vector<char> utf8(static_cast<size_t>(len));
    WideCharToMultiByte(CP_UTF8, 0, value.c_str(), -1, utf8.data(), len, nullptr, nullptr);

    std::wstring out;
    for (int i = 0; i + 1 < len; ++i) {  // len includes the trailing NUL
        unsigned char c = static_cast<unsigned char>(utf8[static_cast<size_t>(i)]);
        bool unreserved = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                          (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~';
        if (unreserved) {
            out += static_cast<wchar_t>(c);
        } else {
            wchar_t hex[4];
            swprintf(hex, 4, L"%%%02X", c);
            out += hex;
        }
    }
    return out;
}

std::wstring BuildQueryString(const SaverOptions& o) {
    return L"?scene=" + EscapeDataString(o.scene) +
           L"&preset=" + EscapeDataString(o.preset) +
           L"&speed=" + EscapeDataString(o.speed) +
           L"&audio=" + OnOff(o.audio) +
           L"&bloom=" + OnOff(o.bloom) +
           L"&trails=" + OnOff(o.trails) +
           L"&scan=" + OnOff(o.scan) +
           L"&crt=" + OnOff(o.crt) +
           L"&matrix=" + OnOff(o.matrix) +
           L"&terminal=" + OnOff(o.terminal) +
           L"&radar=" + OnOff(o.radar) +
           L"&crosshair=" + OnOff(o.crosshair);
}

SaverOptions LoadOptions(const wchar_t* regPath) {
    SaverOptions o;
    o.scene = ReadReg(regPath, L"Scene", o.scene);
    o.preset = ReadReg(regPath, L"Preset", o.preset);
    o.speed = ReadReg(regPath, L"Speed", o.speed);
    o.audio = ReadFlag(regPath, L"Audio", o.audio);
    o.bloom = ReadFlag(regPath, L"Bloom", o.bloom);
    o.trails = ReadFlag(regPath, L"Trails", o.trails);
    o.scan = ReadFlag(regPath, L"Scan", o.scan);
    o.crt = ReadFlag(regPath, L"Crt", o.crt);
    o.matrix = ReadFlag(regPath, L"Matrix", o.matrix);
    o.terminal = ReadFlag(regPath, L"Terminal", o.terminal);
    o.radar = ReadFlag(regPath, L"Radar", o.radar);
    o.crosshair = ReadFlag(regPath, L"Crosshair", o.crosshair);
    return o;
}

void SaveOptions(const SaverOptions& o, const wchar_t* regPath) {
    WriteReg(regPath, L"Scene", o.scene);
    WriteReg(regPath, L"Preset", o.preset);
    WriteReg(regPath, L"Speed", o.speed);
    WriteReg(regPath, L"Audio", OnOff(o.audio));
    WriteReg(regPath, L"Bloom", OnOff(o.bloom));
    WriteReg(regPath, L"Trails", OnOff(o.trails));
    WriteReg(regPath, L"Scan", OnOff(o.scan));
    WriteReg(regPath, L"Crt", OnOff(o.crt));
    WriteReg(regPath, L"Matrix", OnOff(o.matrix));
    WriteReg(regPath, L"Terminal", OnOff(o.terminal));
    WriteReg(regPath, L"Radar", OnOff(o.radar));
    WriteReg(regPath, L"Crosshair", OnOff(o.crosshair));
}

bool ParseSaveMessage(const std::wstring& msg, SaverOptions& out) {
    SaverOptions parsed = out;
    size_t pos = 0;
    while (pos < msg.size()) {
        size_t amp = msg.find(L'&', pos);
        std::wstring pair = msg.substr(pos, amp == std::wstring::npos ? std::wstring::npos : amp - pos);
        pos = (amp == std::wstring::npos) ? msg.size() : amp + 1;

        size_t eq = pair.find(L'=');
        if (eq == std::wstring::npos) return false;
        std::wstring key = pair.substr(0, eq);
        std::wstring val = pair.substr(eq + 1);

        if (key == L"scene") {
            if (!IsSlug(val)) return false;
            parsed.scene = val;
        } else if (key == L"preset") {
            if (!IsSlug(val)) return false;
            parsed.preset = val;
        } else if (key == L"speed") {
            if (val != L"slow" && val != L"norm" && val != L"fast") return false;
            parsed.speed = val;
        } else {
            bool* flag = nullptr;
            if (key == L"audio") flag = &parsed.audio;
            else if (key == L"bloom") flag = &parsed.bloom;
            else if (key == L"trails") flag = &parsed.trails;
            else if (key == L"scan") flag = &parsed.scan;
            else if (key == L"crt") flag = &parsed.crt;
            else if (key == L"matrix") flag = &parsed.matrix;
            else if (key == L"terminal") flag = &parsed.terminal;
            else if (key == L"radar") flag = &parsed.radar;
            else if (key == L"crosshair") flag = &parsed.crosshair;
            if (!flag) return false;
            if (val == L"on") *flag = true;
            else if (val == L"off") *flag = false;
            else return false;
        }
    }
    out = parsed;
    return true;
}
