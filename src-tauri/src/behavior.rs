use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Action {
    Press { key: String },
    Hold { key: String },
    Mousepress { key: String, #[serde(default, rename = "doubleClick", skip_serializing_if = "is_false")] double_click: bool },
    Waitfor { key: String },
    Repeat { key: String, interval: String, hold: String },
    Sequence { steps: Vec<Action> },
    Parallel { steps: Vec<Action> },
    Goto { x: String, y: String },
    Resolution { width: String, height: String },
    State { #[serde(rename = "stateId")] state_id: String, #[serde(default)] action: StateAction },
    Startoverlay { #[serde(rename = "itemId")] item_id: String, #[serde(default)] restart: bool },
    Stopoverlay { #[serde(rename = "itemId")] item_id: String },
    Bar { #[serde(rename = "itemId")] item_id: String, value: String },
    Script { #[serde(rename = "scriptId")] script_id: String },
    Sleep { ms: String },
    Send { text: String },
    Borderless,
    Fit,
    Killprocess,
    Lock,
    Savecursor,
    Restorecursor,
    Stretch,
    Unknown { source: String },
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum StateAction { #[default] Toggle, Set, Clear }

fn is_false(value: &bool) -> bool { !value }

pub fn parse(source: &str) -> Result<Vec<Action>, String> {
    if source.trim().is_empty() { return Ok(Vec::new()); }
    if source.trim_start().starts_with('[') {
        return serde_json::from_str(source).map_err(|error| format!("Invalid behavior: {error}"));
    }
    let mut depth = 0i32;
    let mut start = 0;
    let mut tokens = Vec::new();
    for (index, character) in source.char_indices() {
        match character {
            '(' => depth += 1,
            ')' => depth -= 1,
            ';' if depth == 0 => { tokens.push(&source[start..index]); start = index + 1; }
            _ => {}
        }
    }
    tokens.push(&source[start..]);
    Ok(tokens.into_iter().map(str::trim).filter(|token| !token.is_empty()).map(parse_legacy).collect())
}

fn parse_legacy(source: &str) -> Action {
    let Some((name, tail)) = source.split_once('(') else {
        return match source {
            "borderless" => Action::Borderless, "fit" => Action::Fit,
            "killprocess" => Action::Killprocess, "lock" => Action::Lock,
            "savecursor" => Action::Savecursor, "restorecursor" => Action::Restorecursor,
            "stretch" => Action::Stretch, _ => Action::Unknown { source: source.into() },
        };
    };
    let Some(argument) = tail.strip_suffix(')') else { return Action::Unknown { source: source.into() }; };
    let parts: Vec<_> = argument.split(',').map(str::trim).collect();
    match name.to_ascii_lowercase().as_str() {
        "press" => Action::Press { key: argument.into() },
        "hold" => Action::Hold { key: argument.into() },
        "mousepress" | "pressalt" => Action::Mousepress { key: argument.into(), double_click: false },
        "waitfor" => Action::Waitfor { key: argument.into() },
        "repeat" if parts.len() == 2 || parts.len() == 3 => Action::Repeat {
            key: parts[0].into(), interval: parts[1].into(), hold: parts.get(2).unwrap_or(&"6").to_string(),
        },
        "goto" if parts.len() == 2 => Action::Goto { x: parts[0].into(), y: parts[1].into() },
        "resolution" if parts.len() == 2 => Action::Resolution { width: parts[0].into(), height: parts[1].into() },
        "sleep" => Action::Sleep { ms: argument.into() },
        "send" => Action::Send { text: argument.into() },
        "state" => Action::State { state_id: argument.into(), action: StateAction::Toggle },
        "startoverlay" | "restartoverlay" => Action::Startoverlay { item_id: argument.into(), restart: name == "restartoverlay" },
        _ => Action::Unknown { source: source.into() },
    }
}

pub fn validate(actions: &[Action]) -> Result<(), String> {
    fn number(value: &str, minimum: u32) -> bool { !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) && value.parse::<u32>().map(|n| n >= minimum).unwrap_or(false) }
    for action in actions {
        let valid = match action {
            Action::Sequence { steps } | Action::Parallel { steps } => { validate(steps)?; !steps.is_empty() }
            Action::Press { key } | Action::Hold { key } | Action::Waitfor { key } => !key.trim().is_empty(),
            Action::Mousepress { key, .. } => {
                let parts: Vec<_> = key.split_whitespace().collect();
                parts.last().map(|button| matches!(button.to_ascii_lowercase().as_str(), "lbutton" | "rbutton" | "mbutton" | "xbutton1" | "xbutton2" | "m1" | "m2")).unwrap_or(false)
                    && parts[..parts.len().saturating_sub(1)].iter().all(|part| modifier(part))
            }
            Action::Repeat { key, interval, hold } => !key.trim().is_empty() && number(interval, 1) && number(hold, 0),
            Action::Sleep { ms } => number(ms, 0),
            Action::Goto { x, y } => [x, y].iter().all(|value| value.parse::<f64>().map(f64::is_finite).unwrap_or(false)),
            Action::Resolution { width, height } => number(width, 1) && number(height, 1),
            Action::State { state_id, .. } => !state_id.is_empty(),
            Action::Startoverlay { item_id, .. } | Action::Stopoverlay { item_id } => !item_id.is_empty(),
            Action::Bar { item_id, value } => !item_id.is_empty() && value.parse::<f64>().map(f64::is_finite).unwrap_or(false),
            Action::Script { script_id } => !script_id.is_empty(),
            Action::Unknown { source } => return Err(format!("Unsupported behavior action: {source}")),
            _ => true,
        };
        if !valid { return Err(format!("Invalid behavior action: {action:?}")); }
    }
    Ok(())
}

/// Resolve data at the runtime boundary; persisted actions retain stable variable IDs.
pub fn resolve(source: &str, variables: &[crate::config::NumberVariable]) -> Result<Vec<Action>, String> {
    fn number(value: &mut String, variables: &[crate::config::NumberVariable], minimum: Option<u32>) -> Result<(), String> {
        let Some(id) = value.strip_prefix('$') else { return Ok(()); };
        let variable = variables.iter().find(|variable| variable.id == id)
            .ok_or_else(|| format!("Missing number variable: {id}"))?;
        if !variable.value.is_finite() || minimum.map(|minimum|
            variable.value.fract() != 0.0 || variable.value < minimum as f64 || variable.value > u32::MAX as f64
        ).unwrap_or(false) {
            return Err(format!("Invalid value for variable: {}", variable.name));
        }
        *value = if variable.value == 0.0 { "0".into() } else { variable.value.to_string() };
        Ok(())
    }
    fn visit(actions: &mut [Action], variables: &[crate::config::NumberVariable]) -> Result<(), String> {
        for action in actions {
            match action {
                Action::Sequence { steps } | Action::Parallel { steps } => visit(steps, variables)?,
                Action::Sleep { ms } => number(ms, variables, Some(0))?,
                Action::Repeat { interval, hold, .. } => { number(interval, variables, Some(1))?; number(hold, variables, Some(0))?; }
                Action::Resolution { width, height } => { number(width, variables, Some(1))?; number(height, variables, Some(1))?; }
                Action::Goto { x, y } => { number(x, variables, None)?; number(y, variables, None)?; }
                Action::Bar { value, .. } => number(value, variables, None)?,
                _ => {}
            }
        }
        Ok(())
    }
    let mut actions = parse(source)?;
    visit(&mut actions, variables)?;
    Ok(actions)
}

fn modifier(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "ctrl" | "lctrl" | "rctrl" | "shift" | "lshift" | "rshift" | "alt" | "lalt" | "ralt" | "win" | "lwin" | "rwin")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn editor_and_backend_use_the_same_compatibility_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/behaviors.json")).unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let steps = parse(fixture["source"].as_str().unwrap()).unwrap();
            assert_eq!(serde_json::to_value(&steps).unwrap(), fixture["steps"]);
            let variables: Vec<crate::config::NumberVariable> = serde_json::from_value(fixture.get("variables").cloned().unwrap_or_else(|| serde_json::json!([]))).unwrap();
            assert_eq!(resolve(fixture["source"].as_str().unwrap(), &variables).and_then(|steps| validate(&steps)).is_ok(), fixture["valid"].as_bool().unwrap());
        }
    }
    #[test]
    fn legacy_text_keeps_separators_and_unknown_actions_are_preserved() {
        assert_eq!(parse("send(a;b);press(x)").unwrap(), vec![Action::Send { text: "a;b".into() }, Action::Press { key: "x".into() }]);
        let unknown = parse("future(x)").unwrap();
        assert!(matches!(&unknown[0], Action::Unknown { source } if source == "future(x)"));
        assert!(validate(&unknown).is_err());
    }
    #[test]
    fn variable_values_obey_each_numeric_fields_bounds() {
        for (value, sleep, repeat) in [(0.0, true, false), (-0.0, true, false), (1.0, true, true),
            (u32::MAX as f64, true, true), (u32::MAX as f64 + 1.0, false, false), (-1.0, false, false), (1.5, false, false), (f64::INFINITY, false, false)] {
            let variables = [crate::config::NumberVariable { id: "timer".into(), name: "buff timer".into(), value }];
            assert_eq!(resolve("sleep($timer)", &variables).and_then(|steps| validate(&steps)).is_ok(), sleep, "{value}");
            assert_eq!(resolve("repeat(x,$timer,6)", &variables).and_then(|steps| validate(&steps)).is_ok(), repeat, "{value}");
        }
        let variables = [crate::config::NumberVariable { id: "timer".into(), name: "buff timer".into(), value: -12.5 }];
        assert!(resolve("goto($timer,0)", &variables).and_then(|steps| validate(&steps)).is_ok());
        assert!(resolve("sleep($missing)", &variables).is_err());
    }
    #[test]
    fn groups_round_trip_and_compile_as_data() {
        let source = r#"[{"type":"parallel","steps":[{"type":"hold","key":"rctrl LButton"},{"type":"sequence","steps":[{"type":"sleep","ms":"10"},{"type":"send","text":"a;\"`\n"}]}]}]"#;
        let plan = parse(source).unwrap();
        assert_eq!(parse(&serde_json::to_string(&plan).unwrap()).unwrap(), plan);
        assert!(validate(&plan).is_ok());
    }
    #[test]
    fn invalid_parameters_and_modified_mouse_buttons_are_checked() {
        assert!(validate(&parse("mousepress(rctrl shift LButton)").unwrap()).is_ok());
        for source in ["mousepress(x LButton)", "repeat(a,0)", "resolution(0,720)", "goto(NaN,0)", "hold()"] {
            assert!(validate(&parse(source).unwrap()).is_err(), "{source}");
        }
    }
    #[test]
    fn mousepress_defaults_to_single_and_accepts_only_boolean_double_click() {
        let single = vec![Action::Mousepress { key: "LButton".into(), double_click: false }];
        for source in ["mousepress(LButton)", "pressalt(LButton)",
            r#"[{"type":"mousepress","key":"LButton"}]"#,
            r#"[{"type":"mousepress","key":"LButton","doubleClick":false}]"#] {
            assert_eq!(parse(source).unwrap(), single);
        }
        let double = parse(r#"[{"type":"mousepress","key":"rctrl LButton","doubleClick":true}]"#).unwrap();
        assert!(matches!(&double[0], Action::Mousepress { double_click: true, .. }));
        assert!(validate(&double).is_ok());
        assert_eq!(parse(&serde_json::to_string(&double).unwrap()).unwrap(), double);
        for value in ["null", "2", r#""true""#] {
            assert!(parse(&format!(r#"[{{"type":"mousepress","key":"LButton","doubleClick":{value}}}]"#)).is_err());
        }
    }
}
