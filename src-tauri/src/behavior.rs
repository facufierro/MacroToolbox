use serde::{Deserialize, Serialize};
use crate::variables::VariableReference;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Parameter { Literal(String), Variable(VariableReference), Matched(MatchedInput) }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "source", rename_all = "lowercase", deny_unknown_fields)]
pub enum MatchedInput { Trigger }

impl From<&str> for Parameter {
    fn from(value: &str) -> Self { Self::Literal(value.into()) }
}
impl From<String> for Parameter {
    fn from(value: String) -> Self { Self::Literal(value) }
}
impl Parameter {
    pub fn literal(&self) -> Result<&str, String> {
        match self {
            Self::Literal(value) => Ok(value),
            Self::Variable(reference) => Err(format!("Unresolved variable: {}", reference.variable)),
            Self::Matched(_) => Err("Matched trigger requires a hotkey trigger".into()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum Action {
    Press { key: Parameter, #[serde(default, rename = "onRelease", skip_serializing_if = "is_false")] on_release: bool },
    Hold { key: Parameter },
    Toggle { key: Parameter },
    Mousepress { key: Parameter, #[serde(default, rename = "doubleClick", skip_serializing_if = "is_false")] double_click: bool, #[serde(default, rename = "onRelease", skip_serializing_if = "is_false")] on_release: bool },
    // The key is accepted only at the legacy read boundary; parse moves it to the next action.
    Waitfor { #[serde(default, skip_serializing_if = "Option::is_none")] key: Option<Parameter> },
    Repeat { key: Parameter, interval: Parameter, hold: Parameter },
    Sequence { steps: Vec<Action> },
    Parallel { steps: Vec<Action> },
    Goto { x: Parameter, y: Parameter },
    Resolution { width: Parameter, height: Parameter },
    State { #[serde(rename = "stateId")] state_id: String, #[serde(default)] action: StateAction },
    Startoverlay { #[serde(rename = "itemIds")] item_ids: Vec<String>, #[serde(default)] restart: bool },
    Stopoverlay { #[serde(rename = "itemIds")] item_ids: Vec<String> },
    Bar { #[serde(rename = "itemId")] item_id: String, value: Parameter },
    Script { #[serde(rename = "scriptId")] script_id: String },
    Sleep { ms: Parameter },
    Send { text: Parameter },
    Securesend { #[serde(rename = "credentialId")] credential_id: String },
    Behavior { #[serde(rename = "variableId")] variable_id: String },
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

pub fn valid_credential_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(index, byte)| {
        if [8, 13, 18, 23].contains(&index) { byte == b'-' }
        else { byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte) }
    })
}

pub fn parse(source: &str) -> Result<Vec<Action>, String> {
    let (mut actions, _) = read_actions(source)?;
    normalize_input_waits(&mut actions);
    Ok(actions)
}

fn read_actions(source: &str) -> Result<(Vec<Action>, bool), String> {
    if source.trim().is_empty() { return Ok((Vec::new(), false)); }
    if source.trim_start().starts_with('[') {
        let mut value = serde_json::from_str(source).map_err(|error| format!("Invalid behavior: {error}"))?;
        let upgraded = normalize_overlay_targets(&mut value);
        let mut actions: Vec<Action> = serde_json::from_value(value).map_err(|error| format!("Invalid behavior: {error}"))?;
        normalize_legacy_references(&mut actions)?;
        return Ok((actions, upgraded));
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
    let mut actions = tokens.into_iter().map(str::trim).filter(|token| !token.is_empty()).map(parse_legacy).collect::<Vec<_>>();
    let upgraded = actions.iter().any(|action| matches!(action, Action::Startoverlay { .. } | Action::Stopoverlay { .. }));
    normalize_legacy_references(&mut actions)?;
    Ok((actions, upgraded))
}

fn normalize_overlay_targets(value: &mut serde_json::Value) -> bool {
    let Some(actions) = value.as_array_mut() else { return false; };
    let mut changed = false;
    for action in actions {
        let Some(action) = action.as_object_mut() else { continue; };
        match action.get("type").and_then(|kind| kind.as_str()) {
            Some("sequence" | "parallel") => {
                if let Some(steps) = action.get_mut("steps") { changed |= normalize_overlay_targets(steps); }
            }
            Some("startoverlay" | "stopoverlay") if !action.contains_key("itemIds") => {
                if action.get("itemId").is_some_and(serde_json::Value::is_string) {
                    let id = action.remove("itemId").unwrap();
                    action.insert("itemIds".into(), serde_json::Value::Array(vec![id]));
                    changed = true;
                }
            }
            _ => {}
        }
    }
    changed
}

/// Old waits keep their input condition as the next action; Wait for itself has no value.
fn normalize_input_waits(actions: &mut Vec<Action>) -> bool {
    let mut changed = false;
    let mut normalized = Vec::new();
    for mut action in std::mem::take(actions) {
        if let Action::Sequence { steps } | Action::Parallel { steps } = &mut action {
            changed |= normalize_input_waits(steps);
        }
        if let Action::Waitfor { key: Some(Parameter::Matched(_)) } = &action {
            normalized.push(action);
        } else if let Action::Waitfor { key: Some(key) } = action {
            normalized.push(Action::Waitfor { key: None });
            normalized.push(if matches!(&key, Parameter::Literal(value) if valid_mouse_input(value)) {
                Action::Mousepress { key, double_click: false, on_release: false }
            } else { Action::Press { key, on_release: false } });
            changed = true;
        } else { normalized.push(action); }
    }
    *actions = normalized;
    changed
}

pub fn upgrade_legacy_actions(source: &str) -> Result<Option<String>, String> {
    let lower = source.to_ascii_lowercase();
    if !["waitfor", "startoverlay", "stopoverlay", "restartoverlay"].iter().any(|kind| lower.contains(*kind)) { return Ok(None); }
    let (mut actions, upgraded_overlays) = read_actions(source)?;
    let upgraded_waits = normalize_input_waits(&mut actions);
    if !upgraded_overlays && !upgraded_waits { return Ok(None); }
    serde_json::to_string(&actions).map(Some).map_err(|error| error.to_string())
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
        "press" => Action::Press { key: argument.into(), on_release: false },
        "hold" => Action::Hold { key: argument.into() },
        "toggle" => Action::Toggle { key: argument.into() },
        "mousepress" | "pressalt" => Action::Mousepress { key: argument.into(), double_click: false, on_release: false },
        "waitfor" => Action::Waitfor { key: Some(argument.into()) },
        "repeat" if parts.len() == 2 || parts.len() == 3 => Action::Repeat {
            key: parts[0].into(), interval: parts[1].into(), hold: parts.get(2).unwrap_or(&"6").to_string().into(),
        },
        "goto" if parts.len() == 2 => Action::Goto { x: parts[0].into(), y: parts[1].into() },
        "resolution" if parts.len() == 2 => Action::Resolution { width: parts[0].into(), height: parts[1].into() },
        "sleep" => Action::Sleep { ms: argument.into() },
        "send" => Action::Send { text: argument.into() },
        "state" => Action::State { state_id: argument.into(), action: StateAction::Toggle },
        "startoverlay" | "restartoverlay" => Action::Startoverlay { item_ids: vec![argument.into()], restart: name == "restartoverlay" },
        "stopoverlay" => Action::Stopoverlay { item_ids: vec![argument.into()] },
        _ => Action::Unknown { source: source.into() },
    }
}

fn valid_mouse_input(key: &str) -> bool {
    let parts: Vec<_> = key.split_whitespace().collect();
    parts.last().map(|button| matches!(button.to_ascii_lowercase().as_str(), "lbutton" | "rbutton" | "mbutton" | "xbutton1" | "xbutton2" | "m1" | "m2")).unwrap_or(false)
        && parts[..parts.len().saturating_sub(1)].iter().all(|part| modifier(part))
}

pub fn validate(actions: &[Action], has_trigger: bool) -> Result<(), String> {
    fn number(value: &str, minimum: u32) -> bool { !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()) && value.parse::<u32>().map(|n| n >= minimum).unwrap_or(false) }
    for (index, action) in actions.iter().enumerate() {
        if !has_trigger && matches!(action, Action::Press { on_release: true, .. } | Action::Mousepress { on_release: true, .. }) {
            return Err("On release requires a hotkey trigger.".into());
        }
        let valid = match action {
            Action::Sequence { steps } | Action::Parallel { steps } => { validate(steps, has_trigger)?; !steps.is_empty() }
            Action::Press { key: Parameter::Matched(_), .. } => has_trigger,
            Action::Waitfor { key: None } => index + 1 < actions.len(),
            Action::Waitfor { key: Some(key) } | Action::Press { key, .. } | Action::Hold { key } => !key.literal()?.trim().is_empty(),
            Action::Toggle { key } => has_trigger && !key.literal()?.trim().is_empty(),
            Action::Mousepress { key, .. } => valid_mouse_input(key.literal()?),
            Action::Repeat { key, interval, hold } => !key.literal()?.trim().is_empty() && number(interval.literal()?, 1) && number(hold.literal()?, 0),
            Action::Sleep { ms } => number(ms.literal()?, 0),
            Action::Goto { x, y } => [x.literal()?, y.literal()?].iter().all(|value| value.parse::<f64>().map(f64::is_finite).unwrap_or(false)),
            Action::Resolution { width, height } => number(width.literal()?, 1) && number(height.literal()?, 1),
            Action::State { state_id, .. } => !state_id.is_empty(),
            Action::Startoverlay { item_ids, .. } | Action::Stopoverlay { item_ids } => !item_ids.is_empty()
                && item_ids.iter().all(|id| !id.trim().is_empty()) && item_ids.iter().collect::<std::collections::HashSet<_>>().len() == item_ids.len(),
            Action::Bar { item_id, value } => !item_id.is_empty() && value.literal()?.parse::<f64>().map(f64::is_finite).unwrap_or(false),
            Action::Send { text } => { text.literal()?; true }
            Action::Securesend { credential_id } => has_trigger && valid_credential_id(credential_id),
            Action::Script { script_id } => !script_id.is_empty(),
            Action::Unknown { source } => return Err(format!("Unsupported behavior action: {source}")),
            Action::Behavior { variable_id } => return Err(format!("Unresolved behavior variable: {variable_id}")),
            _ => true,
        };
        if !valid { return Err(format!("Invalid behavior action: {action:?}")); }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum ValueKind { Number(Option<u32>), Press, Keys, Mouse, Text }

fn visit_values(actions: &mut [Action], visit: &mut impl FnMut(&mut Parameter, ValueKind) -> Result<(), String>) -> Result<(), String> {
    for action in actions {
        match action {
            Action::Sequence { steps } | Action::Parallel { steps } => visit_values(steps, visit)?,
            Action::Press { key, .. } => visit(key, ValueKind::Press)?,
            Action::Hold { key } | Action::Toggle { key } | Action::Waitfor { key: Some(key) } => visit(key, ValueKind::Keys)?,
            Action::Mousepress { key, .. } => visit(key, ValueKind::Mouse)?,
            Action::Send { text } => visit(text, ValueKind::Text)?,
            Action::Sleep { ms } => visit(ms, ValueKind::Number(Some(0)))?,
            Action::Repeat { key, interval, hold } => { visit(key, ValueKind::Keys)?; visit(interval, ValueKind::Number(Some(1)))?; visit(hold, ValueKind::Number(Some(0)))?; }
            Action::Resolution { width, height } => { visit(width, ValueKind::Number(Some(1)))?; visit(height, ValueKind::Number(Some(1)))?; }
            Action::Goto { x, y } => { visit(x, ValueKind::Number(None))?; visit(y, ValueKind::Number(None))?; }
            Action::Bar { value, .. } => visit(value, ValueKind::Number(None))?,
            _ => {}
        }
    }
    Ok(())
}

fn normalize_legacy_references(actions: &mut [Action]) -> Result<(), String> {
    visit_values(actions, &mut |value, kind| {
        if matches!(kind, ValueKind::Number(_)) {
            if let Parameter::Literal(literal) = value {
                if let Some(id) = literal.strip_prefix('$') {
                    *value = Parameter::Variable(VariableReference { variable: id.into() });
                }
            }
        }
        Ok(())
    })
}

/// Resolve typed values at the runtime boundary. Literal strings are never interpolated.
pub fn resolve(source: &str, variables: &[crate::variables::Variable], matched_trigger: Option<&str>) -> Result<Vec<Action>, String> {
    let mut actions = expand(parse(source)?, variables, &mut Vec::new())?;
    resolve_values(&mut actions, variables, matched_trigger, false)?;
    if matched_trigger.is_none() && requires_trigger(&actions) {
        return Err("This behavior requires a hotkey trigger.".into());
    }
    Ok(actions)
}

/// Resolve dependencies for validation before a hotkey has a shortcut. Matched input
/// stays symbolic; these actions must not be sent to the runtime.
pub fn resolve_template(source: &str, variables: &[crate::variables::Variable]) -> Result<Vec<Action>, String> {
    let mut actions = expand(parse(source)?, variables, &mut Vec::new())?;
    resolve_values(&mut actions, variables, None, true)?;
    Ok(actions)
}

fn requires_trigger(actions: &[Action]) -> bool {
    actions.iter().any(|action| match action {
        Action::Toggle { .. } | Action::Securesend { .. } | Action::Press { on_release: true, .. } | Action::Mousepress { on_release: true, .. } => true,
        Action::Sequence { steps } | Action::Parallel { steps } => requires_trigger(steps),
        _ => false,
    })
}

pub fn has_toggle(actions: &[Action]) -> bool {
    actions.iter().any(|action| match action {
        Action::Toggle { .. } => true,
        Action::Sequence { steps } | Action::Parallel { steps } => has_toggle(steps),
        _ => false,
    })
}

fn expand(actions: Vec<Action>, variables: &[crate::variables::Variable], visiting: &mut Vec<String>) -> Result<Vec<Action>, String> {
    use crate::variables::VariableValue;
    actions.into_iter().map(|action| Ok(match action {
        Action::Behavior { variable_id } => {
            let variable = variables.iter().find(|variable| variable.id == variable_id)
                .ok_or_else(|| format!("Missing behavior variable: {variable_id}"))?;
            let VariableValue::Behavior(source) = &variable.value else { return Err(format!("{} must be a Behavior variable", variable.name)); };
            if visiting.contains(&variable_id) { return Err(format!("Circular behavior variable: {}", variable.name)); }
            visiting.push(variable_id);
            let steps = expand(parse(source)?, variables, visiting)?;
            visiting.pop();
            // A reference is one sequential branch even when its caller is parallel.
            Action::Sequence { steps }
        }
        Action::Sequence { steps } => Action::Sequence { steps: expand(steps, variables, visiting)? },
        Action::Parallel { steps } => Action::Parallel { steps: expand(steps, variables, visiting)? },
        other => other,
    })).collect()
}

pub fn validate_variable_behaviors(variables: &[crate::variables::Variable]) -> Result<(), String> {
    for variable in variables {
        if let crate::variables::VariableValue::Behavior(source) = &variable.value {
            let mut actions = expand(parse(source)?, variables, &mut vec![variable.id.clone()])?;
            if actions.is_empty() { return Err(format!("Enter behavior steps: {}", variable.name)); }
            resolve_values(&mut actions, variables, None, true)?;
            validate(&actions, true)?;
        }
    }
    Ok(())
}

fn resolve_values(actions: &mut [Action], variables: &[crate::variables::Variable], matched_trigger: Option<&str>, template: bool) -> Result<(), String> {
    use crate::variables::VariableValue;
    visit_values(actions, &mut |value, kind| {
        if matches!(value, Parameter::Matched(_)) {
            if template && matches!(kind, ValueKind::Press) { return Ok(()); }
            if let (ValueKind::Press, Some(trigger)) = (kind, matched_trigger) {
                if !trigger.trim().is_empty() {
                    *value = Parameter::Literal(trigger.into());
                    return Ok(());
                }
            }
            return Err("Matched trigger is only available to Press in a hotkey".into());
        }
        let Parameter::Variable(reference) = value else { return Ok(()); };
        let variable = variables.iter().find(|variable| variable.id == reference.variable)
            .ok_or_else(|| format!("Missing variable: {}", reference.variable))?;
        let literal = match (&variable.value, kind) {
            (VariableValue::Number(number), ValueKind::Number(minimum)) => {
                if !number.is_finite() || minimum.map(|minimum| number.fract() != 0.0 || *number < minimum as f64 || *number > u32::MAX as f64).unwrap_or(false) {
                    return Err(format!("Invalid number for this field: {}", variable.name));
                }
                if *number == 0.0 { "0".into() } else { number.to_string() }
            }
            (VariableValue::Text(text), ValueKind::Text) => text.clone(),
            (VariableValue::Keys(keys), ValueKind::Keys | ValueKind::Press) if !keys.trim().is_empty() => keys.clone(),
            (VariableValue::Keys(keys), ValueKind::Mouse) if valid_mouse_input(keys) => keys.clone(),
            _ => return Err(format!("Variable has an incompatible type or value: {}", variable.name)),
        };
        *value = Parameter::Literal(literal);
        Ok(())
    })
}

fn modifier(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "ctrl" | "lctrl" | "rctrl" | "shift" | "lshift" | "rshift" | "alt" | "lalt" | "ralt" | "win" | "lwin" | "rwin")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlay_target_lists_upgrade_legacy_actions_and_reject_ambiguous_sources() {
        let source = r#"[{"type":"sequence","steps":[{"type":"startoverlay","itemId":"first","restart":true},{"type":"stopoverlay","itemId":"second"}]}]"#;
        let upgraded = upgrade_legacy_actions(source).unwrap().unwrap();
        let actions = parse(&upgraded).unwrap();
        assert_eq!(serde_json::to_value(&actions).unwrap(), serde_json::json!([{"type":"sequence","steps":[
            {"type":"startoverlay","itemIds":["first"],"restart":true},{"type":"stopoverlay","itemIds":["second"]}]}]));
        assert!(upgrade_legacy_actions(&upgraded).unwrap().is_none());
        assert!(validate(&actions,false).is_ok());
        for source in [r#"[{"type":"startoverlay","itemIds":["a"],"itemId":"b"}]"#,
            r#"[{"type":"stopoverlay","itemIds":["a",4]}]"#,
            r#"[{"type":"stopoverlay","itemIds":["a"],"future":true}]"#] {
            assert!(parse(source).is_err(), "{source}");
        }
    }

    #[test]
    fn next_action_waits_preserve_the_following_action_and_reject_missing_siblings() {
        for source in [
            r#"[{"type":"waitfor"},{"type":"mousepress","key":"rctrl LButton","onRelease":true,"doubleClick":true}]"#,
            r#"[{"type":"waitfor"},{"type":"startoverlay","itemIds":["timer"],"restart":true}]"#,
            r#"[{"type":"waitfor"},{"type":"parallel","steps":[{"type":"sleep","ms":"25"},{"type":"press","key":"x"}]}]"#,
        ] {
            let actions = resolve(source, &[], Some("q")).unwrap();
            assert!(validate(&actions, true).is_ok());
            assert_eq!(serde_json::to_value(actions).unwrap(),serde_json::from_str::<serde_json::Value>(source).unwrap());
        }
        for source in [
            r#"[{"type":"waitfor"}]"#,
            r#"[{"type":"send","text":"prefix"},{"type":"waitfor"}]"#,
            r#"[{"type":"sequence","steps":[{"type":"waitfor"}]},{"type":"press","key":"x"}]"#,
            r#"[{"type":"parallel","steps":[{"type":"press","key":"x"},{"type":"waitfor"}]}]"#,
        ] { assert!(validate(&resolve(source,&[],Some("q")).unwrap(),true).is_err()); }
        let release = r#"[{"type":"waitfor"},{"type":"mousepress","key":"LButton","onRelease":true}]"#;
        assert!(resolve(release,&[],None).is_err());
        assert!(validate(&resolve_template(release,&[]).unwrap(),true).is_ok());
        let legacy = parse("waitfor(LButton)").unwrap();
        assert_eq!(serde_json::to_value(&legacy).unwrap(),serde_json::json!([{"type":"waitfor"},{"type":"mousepress","key":"LButton"}]));
        assert!(validate(&legacy,false).is_ok());
    }

    fn shared(id: &str, steps: serde_json::Value) -> crate::variables::Variable {
        serde_json::from_value(serde_json::json!({"id":id,"name":id,"type":"behavior","value":steps.to_string()})).unwrap()
    }

    #[test]
    fn behavior_variables_expand_as_sequential_branches_with_the_callers_trigger() {
        let inner = shared("cast", serde_json::json!([
            {"type":"press","key":{"source":"trigger"},"onRelease":true},
            {"type":"sleep","ms":{"variable":"timer"}},
            {"type":"mousepress","key":"LButton","doubleClick":true}
        ]));
        let outer = shared("chain", serde_json::json!([{"type":"behavior","variableId":"cast"},{"type":"press","key":"e"}]));
        let timer = serde_json::from_value(serde_json::json!({"id":"timer","name":"Delay","type":"number","value":150})).unwrap();
        let variables = vec![outer, inner.clone(), timer];
        crate::config::validate_variables(&variables).unwrap();
        let source = r#"[{"type":"parallel","steps":[{"type":"behavior","variableId":"chain"},{"type":"hold","key":"x"}]}]"#;
        for trigger in ["lctrl 1", "rctrl shift n"] {
            let actions = resolve(source, &variables, Some(trigger)).unwrap();
            validate(&actions, true).unwrap();
            assert_eq!(serde_json::to_value(actions).unwrap(), serde_json::json!([
                {"type":"parallel","steps":[{"type":"sequence","steps":[{"type":"sequence","steps":[
                    {"type":"press","key":trigger,"onRelease":true},{"type":"sleep","ms":"150"},
                    {"type":"mousepress","key":"LButton","doubleClick":true}
                ]},{"type":"press","key":"e"}]},{"type":"hold","key":"x"}]}
            ]));
        }
        assert!(resolve(source, &variables, None).is_err());
        assert_eq!(variables[1], inner);
        let ordinary = shared("ordinary", serde_json::json!([{"type":"send","text":"hello"},{"type":"sleep","ms":"10"}]));
        validate(&resolve(r#"[{"type":"behavior","variableId":"ordinary"}]"#, &[ordinary], None).unwrap(), false).unwrap();
    }

    #[test]
    fn shared_behavior_graphs_reject_cycles_wrong_types_missing_dependencies_and_invalid_values() {
        for variables in [
            vec![shared("a", serde_json::json!([{"type":"behavior","variableId":"a"}]))],
            vec![shared("a", serde_json::json!([{"type":"behavior","variableId":"b"}])), shared("b", serde_json::json!([{"type":"behavior","variableId":"a"}]))],
            vec![shared("a", serde_json::json!([{"type":"behavior","variableId":"missing"}]))],
            vec![shared("a", serde_json::json!([{"type":"sleep","ms":{"variable":"missing"}}]))],
            vec![shared("a", serde_json::json!([{"type":"sleep","ms":"-1"}]))],
            vec![shared("a", serde_json::json!([]))],
        ] { assert!(crate::config::validate_variables(&variables).is_err(), "{variables:?}"); }
        let keys = serde_json::from_value(serde_json::json!({"id":"keys","name":"Keys","type":"keys","value":"rctrl n"})).unwrap();
        assert!(crate::config::validate_variables(&[keys, shared("a", serde_json::json!([{"type":"behavior","variableId":"keys"}]))]).is_err());
        let secure = shared("secure", serde_json::json!([{"type":"securesend","credentialId":"b8483943-e86c-41aa-a593-7388833369cd"}]));
        crate::config::validate_variables(std::slice::from_ref(&secure)).unwrap();
        assert!(resolve(r#"[{"type":"behavior","variableId":"secure"}]"#, std::slice::from_ref(&secure), None).is_err());
        validate(&resolve(r#"[{"type":"behavior","variableId":"secure"}]"#, &[secure], Some("f1")).unwrap(), true).unwrap();
    }

    #[test]
    fn secure_send_only_serializes_a_reference_and_requires_a_hotkey() {
        let source = r#"[{"type":"securesend","credentialId":"b8483943-e86c-41aa-a593-7388833369cd"}]"#;
        let actions = resolve(source, &[], Some("f1")).unwrap();
        validate(&actions, true).unwrap();
        assert!(validate(&actions, false).is_err());
        assert_eq!(serde_json::to_string(&actions).unwrap(), source);
        assert!(parse(r#"[{"type":"securesend","credentialId":"b8483943-e86c-41aa-a593-7388833369cd","password":"fixture-only"}]"#).is_err());
    }

    #[test]
    fn toggle_keys_resolve_inside_shared_behaviors_but_reject_triggerless_callers() {
        let keys = serde_json::from_value(serde_json::json!({"id":"keys","name":"Movement","type":"keys","value":"rctrl w LButton"})).unwrap();
        let shared = shared("walk", serde_json::json!([{"type":"toggle","key":{"variable":"keys"}}]));
        let variables = vec![keys, shared];
        crate::config::validate_variables(&variables).unwrap();
        let source = r#"[{"type":"send","text":"prefix"},{"type":"behavior","variableId":"walk"}]"#;
        let resolved = resolve(source, &variables, Some("f1")).unwrap();
        validate(&resolved, true).unwrap();
        assert_eq!(serde_json::to_value(&resolved).unwrap(), serde_json::json!([
            {"type":"send","text":"prefix"},{"type":"sequence","steps":[{"type":"toggle","key":"rctrl w LButton"}]}
        ]));
        assert!(validate(&resolved, false).is_err());
        assert!(resolve(source, &variables, None).is_err());
    }

    #[test]
    fn matched_trigger_resolves_only_press_and_keeps_nested_release_actions() {
        let source = r#"[{"type":"sequence","steps":[{"type":"press","key":{"source":"trigger"},"onRelease":true},{"type":"press","key":"e"}]}]"#;
        assert_eq!(serde_json::to_value(parse(source).unwrap()).unwrap(), serde_json::from_str::<serde_json::Value>(source).unwrap());
        for trigger in ["lctrl 1", "lctrl 2", "lctrl 3", "rctrl shift o"] {
            let resolved = resolve(source, &[], Some(trigger)).unwrap();
            validate(&resolved, true).unwrap();
            assert_eq!(serde_json::to_value(resolved).unwrap(), serde_json::json!([
                {"type":"sequence","steps":[{"type":"press","key":trigger,"onRelease":true},{"type":"press","key":"e"}]}
            ]));
        }
        assert!(resolve(source, &[], None).is_err());
        assert!(resolve(source, &[], Some(" ")).is_err());
        for action in [
            serde_json::json!({"type":"hold","key":{"source":"trigger"}}),
            serde_json::json!({"type":"waitfor","key":{"source":"trigger"}}),
            serde_json::json!({"type":"mousepress","key":{"source":"trigger"}}),
            serde_json::json!({"type":"send","text":{"source":"trigger"}}),
            serde_json::json!({"type":"sleep","ms":{"source":"trigger"}}),
        ] {
            assert!(resolve(&serde_json::json!([action]).to_string(), &[], Some("lctrl 1")).is_err());
        }
    }

    #[test]
    fn unassigned_hotkey_templates_preserve_trigger_dependent_actions_and_resolve_dependencies() {
        let variables = vec![
            shared("cast", serde_json::json!([
                {"type":"press","key":{"source":"trigger"},"onRelease":true},
                {"type":"mousepress","key":"LButton","onRelease":true},
                {"type":"toggle","key":"rctrl w"},
                {"type":"securesend","credentialId":"b8483943-e86c-41aa-a593-7388833369cd"},
                {"type":"sleep","ms":{"variable":"delay"}}
            ])),
            serde_json::from_value(serde_json::json!({"id":"delay","name":"Delay","type":"number","value":150})).unwrap(),
        ];
        let source = r#"[{"type":"parallel","steps":[{"type":"behavior","variableId":"cast"}]}]"#;
        let actions = resolve_template(source, &variables).unwrap();
        validate(&actions, true).unwrap();
        let data = serde_json::to_value(&actions).unwrap();
        assert_eq!(data[0]["steps"][0]["steps"][0]["key"], serde_json::json!({"source":"trigger"}));
        assert_eq!(data[0]["steps"][0]["steps"][4]["ms"], "150");
        assert!(validate(&actions, false).is_err());
        assert!(resolve(source, &variables, None).is_err());
        assert!(resolve_template(source, &[]).is_err());

        for source in [
            r#"[{"type":"press","key":"x","onRelease":true}]"#,
            r#"[{"type":"mousepress","key":"LButton","onRelease":true}]"#,
            "toggle(rctrl w)",
            r#"[{"type":"securesend","credentialId":"b8483943-e86c-41aa-a593-7388833369cd"}]"#,
        ] {
            validate(&resolve_template(source, &[]).unwrap(), true).unwrap();
            assert!(resolve(source, &[], None).is_err(), "{source}");
        }
    }

    #[test]
    fn unassigned_hotkey_templates_still_reject_invalid_actions_and_dependencies() {
        for source in [
            "repeat(x,0)", "hold()", "future(x)", "sleep($missing)",
            r#"[{"type":"hold","key":{"source":"trigger"}}]"#,
            r#"[{"type":"send","text":{"source":"trigger"}}]"#,
            r#"[{"type":"securesend","credentialId":"invalid"}]"#,
        ] {
            assert!(resolve_template(source, &[]).and_then(|actions| validate(&actions, true)).is_err(), "{source}");
        }
        let cycle = shared("cycle", serde_json::json!([{"type":"behavior","variableId":"cycle"}]));
        assert!(resolve_template(r#"[{"type":"behavior","variableId":"cycle"}]"#, &[cycle]).is_err());
        let invalid = serde_json::from_value(serde_json::json!({"id":"delay","name":"Delay","type":"number","value":-1})).unwrap();
        assert!(resolve_template("sleep($delay)", &[invalid]).is_err());
    }

    #[test]
    fn editor_and_backend_use_the_same_compatibility_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!("../../tests/fixtures/behaviors.json")).unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let steps = parse(fixture["source"].as_str().unwrap()).unwrap();
            assert_eq!(serde_json::to_value(&steps).unwrap(), fixture["steps"]);
            let variables: Vec<crate::config::Variable> = serde_json::from_value(fixture.get("variables").cloned().unwrap_or_else(|| serde_json::json!([]))).unwrap();
            let has_trigger = fixture.get("hasTrigger").and_then(|value| value.as_bool()).unwrap_or(true);
            let matched_trigger = fixture.get("matchedTrigger").and_then(|value| value.as_str()).or_else(|| has_trigger.then_some("f1"));
            assert_eq!(resolve(fixture["source"].as_str().unwrap(), &variables, matched_trigger).and_then(|steps| validate(&steps, has_trigger)).is_ok(), fixture["valid"].as_bool().unwrap());
            if let Some(expected) = fixture.get("resolved") {
                assert_eq!(serde_json::to_value(resolve(fixture["source"].as_str().unwrap(), &variables, matched_trigger).unwrap()).unwrap(), *expected);
            }
        }
    }
    #[test]
    fn legacy_text_keeps_separators_and_unknown_actions_are_preserved() {
        assert_eq!(parse("send(a;b);press(x)").unwrap(), vec![Action::Send { text: "a;b".into() }, Action::Press { key: "x".into(), on_release: false }]);
        let unknown = parse("future(x)").unwrap();
        assert!(matches!(&unknown[0], Action::Unknown { source } if source == "future(x)"));
        assert!(validate(&unknown, true).is_err());
    }
    #[test]
    fn variable_values_obey_each_numeric_fields_bounds() {
        for (value, sleep, repeat) in [(0.0, true, false), (-0.0, true, false), (1.0, true, true),
            (u32::MAX as f64, true, true), (u32::MAX as f64 + 1.0, false, false), (-1.0, false, false), (1.5, false, false), (f64::INFINITY, false, false)] {
            let variables = [crate::config::Variable { id: "timer".into(), name: "buff timer".into(), value: value.into() }];
            assert_eq!(resolve("sleep($timer)", &variables, None).and_then(|steps| validate(&steps, true)).is_ok(), sleep, "{value}");
            assert_eq!(resolve("repeat(x,$timer,6)", &variables, None).and_then(|steps| validate(&steps, true)).is_ok(), repeat, "{value}");
        }
        let variables = [crate::config::Variable { id: "timer".into(), name: "buff timer".into(), value: (-12.5).into() }];
        assert!(resolve("goto($timer,0)", &variables, None).and_then(|steps| validate(&steps, true)).is_ok());
        assert!(resolve("sleep($missing)", &variables, None).is_err());
    }
    #[test]
    fn groups_round_trip_and_compile_as_data() {
        let source = r#"[{"type":"parallel","steps":[{"type":"hold","key":"rctrl LButton"},{"type":"sequence","steps":[{"type":"sleep","ms":"10"},{"type":"send","text":"a;\"`\n"}]}]}]"#;
        let plan = parse(source).unwrap();
        assert_eq!(parse(&serde_json::to_string(&plan).unwrap()).unwrap(), plan);
        assert!(validate(&plan, true).is_ok());
    }
    #[test]
    fn invalid_parameters_and_modified_mouse_buttons_are_checked() {
        assert!(validate(&parse("mousepress(rctrl shift LButton)").unwrap(), true).is_ok());
        for source in ["mousepress(x LButton)", "repeat(a,0)", "resolution(0,720)", "goto(NaN,0)", "hold()"] {
            assert!(validate(&parse(source).unwrap(), true).is_err(), "{source}");
        }
    }
    #[test]
    fn press_activation_defaults_to_press_and_requires_boolean_release_flags() {
        for (kind, key) in [("press", "x"), ("mousepress", "LButton")] {
            let default = parse(&format!(r#"[{{"type":"{kind}","key":"{key}"}}]"#)).unwrap();
            assert!(validate(&default, false).is_ok());
            assert!(serde_json::to_value(&default).unwrap()[0].get("onRelease").is_none());
            let release = parse(&format!(r#"[{{"type":"{kind}","key":"{key}","onRelease":true}}]"#)).unwrap();
            assert!(validate(&release, true).is_ok());
            assert_eq!(validate(&release, false).unwrap_err(), "On release requires a hotkey trigger.");
            assert_eq!(parse(&serde_json::to_string(&release).unwrap()).unwrap(), release);
            for value in ["null", "1", r#""true""#] {
                assert!(parse(&format!(r#"[{{"type":"{kind}","key":"{key}","onRelease":{value}}}]"#)).is_err());
            }
        }
    }

    #[test]
    fn mousepress_defaults_to_single_and_accepts_only_boolean_double_click() {
        let single = vec![Action::Mousepress { key: "LButton".into(), double_click: false, on_release: false }];
        for source in ["mousepress(LButton)", "pressalt(LButton)",
            r#"[{"type":"mousepress","key":"LButton"}]"#,
            r#"[{"type":"mousepress","key":"LButton","doubleClick":false}]"#] {
            assert_eq!(parse(source).unwrap(), single);
        }
        let double = parse(r#"[{"type":"mousepress","key":"rctrl LButton","doubleClick":true}]"#).unwrap();
        assert!(matches!(&double[0], Action::Mousepress { double_click: true, .. }));
        assert!(validate(&double, true).is_ok());
        assert_eq!(parse(&serde_json::to_string(&double).unwrap()).unwrap(), double);
        for value in ["null", "2", r#""true""#] {
            assert!(parse(&format!(r#"[{{"type":"mousepress","key":"LButton","doubleClick":{value}}}]"#)).is_err());
        }
    }
}
