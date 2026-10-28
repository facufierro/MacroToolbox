class JsonReader {
    static Parse(text) {
        reader := JsonReader()
        reader.text := text, reader.position := 1
        value := reader.Value()
        reader.Space()
        if reader.position <= StrLen(text)
            throw ValueError("Unexpected JSON content.")
        return value
    }
    Space() {
        while this.position <= StrLen(this.text) && InStr(" `t`r`n", SubStr(this.text, this.position, 1))
            this.position++
    }
    Value() {
        this.Space()
        character := SubStr(this.text, this.position, 1)
        if character = '"'
            return this.String()
        if character = "[" || character = "{" {
            this.position++
            isArray := character = "["
            result := isArray ? [] : Map()
            end := isArray ? "]" : "}"
            this.Space()
            if SubStr(this.text, this.position, 1) = end {
                this.position++
                return result
            }
            loop {
                this.Space()
                if isArray {
                    result.Push(this.Value())
                } else {
                    key := this.String()
                    this.Space()
                    if SubStr(this.text, this.position++, 1) != ":"
                        throw ValueError("Expected JSON colon.")
                    result[key] := this.Value()
                }
                this.Space()
                separator := SubStr(this.text, this.position++, 1)
                if separator = end
                    return result
                if separator != ","
                    throw ValueError("Expected JSON separator.")
            }
        }
        for literal, value in Map("true", true, "false", false, "null", "") {
            if SubStr(this.text, this.position, StrLen(literal)) = literal {
                this.position += StrLen(literal)
                return value
            }
        }
        if RegExMatch(SubStr(this.text, this.position), "^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?", &match) {
            this.position += StrLen(match[0])
            return Number(match[0])
        }
        throw ValueError("Invalid JSON value.")
    }
    String() {
        if SubStr(this.text, this.position++, 1) != '"'
            throw ValueError("Expected JSON string.")
        result := ""
        while this.position <= StrLen(this.text) {
            character := SubStr(this.text, this.position++, 1)
            if character = '"'
                return result
            if character = "\" {
                character := SubStr(this.text, this.position++, 1)
                if character = "u" {
                    hex := SubStr(this.text, this.position, 4)
                    if !RegExMatch(hex, "^[0-9a-fA-F]{4}$")
                        throw ValueError("Invalid JSON Unicode escape.")
                    this.position += 4
                    code := Integer("0x" hex)
                    if code >= 0xD800 && code <= 0xDBFF && SubStr(this.text, this.position, 2) = "\u" {
                        low := Integer("0x" SubStr(this.text, this.position + 2, 4))
                        if low < 0xDC00 || low > 0xDFFF
                            throw ValueError("Invalid JSON surrogate pair.")
                        code := 0x10000 + ((code - 0xD800) << 10) + low - 0xDC00
                        this.position += 6
                    }
                    result .= Chr(code)
                    continue
                }
                escapes := Map('"', '"', "\", "\", "/", "/", "n", "`n", "r", "`r", "t", "`t", "b", Chr(8), "f", Chr(12))
                if !escapes.Has(character)
                    throw ValueError("Invalid JSON escape.")
                character := escapes[character]
            } else if Ord(character) < 32 {
                throw ValueError("Unescaped JSON control character.")
            }
            result .= character
        }
        throw ValueError("Unterminated JSON string.")
    }
}

JsonString(value) {
    value := StrReplace(value, "\", "\\")
    value := StrReplace(value, '"', '\"')
    value := StrReplace(value, "`r", "\r")
    value := StrReplace(value, "`n", "\n")
    value := StrReplace(value, "`t", "\t")
    return '"' value '"'
}
