use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(deny_unknown_fields)]
pub struct VariableReference { pub variable: String }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum VariableValue {
    Number(f64),
    Text(String),
    Keys(String),
    Triggers(Vec<String>),
    Behavior(String),
}

impl From<f64> for VariableValue {
    fn from(value: f64) -> Self { Self::Number(value) }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(try_from = "VariableWire")]
pub struct Variable {
    pub id: String,
    pub name: String,
    #[serde(flatten)]
    pub value: VariableValue,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "lowercase")]
enum VariableType { #[default] Number, Text, Keys, Triggers, Behavior }

#[derive(Deserialize)]
struct VariableWire {
    id: String,
    name: String,
    // v6 number variables had no type field.
    #[serde(default, rename = "type")]
    kind: VariableType,
    value: serde_json::Value,
}

impl TryFrom<VariableWire> for Variable {
    type Error = String;
    fn try_from(wire: VariableWire) -> Result<Self, String> {
        let value = match wire.kind {
            VariableType::Number => VariableValue::Number(wire.value.as_f64().ok_or("Expected a number variable value")?),
            VariableType::Text => VariableValue::Text(wire.value.as_str().ok_or("Expected a text variable value")?.into()),
            VariableType::Keys => VariableValue::Keys(wire.value.as_str().ok_or("Expected a keys variable value")?.into()),
            VariableType::Behavior => VariableValue::Behavior(wire.value.as_str().ok_or("Expected a behavior variable value")?.into()),
            VariableType::Triggers => {
                let entries = wire.value.as_array().ok_or("Expected a trigger list")?.iter()
                    .map(|value| value.as_str().map(String::from).ok_or("Expected trigger keys".to_string())).collect::<Result<Vec<_>, _>>()?;
                VariableValue::Triggers(read_trigger_list(&entries)?)
            }
        };
        Ok(Self { id: wire.id, name: wire.name, value })
    }
}

pub fn read_trigger_list(entries: &[String]) -> Result<Vec<String>, String> {
    if entries.is_empty() { return Err("Enter at least one trigger".into()); }
    let mut seen = HashSet::new();
    entries.iter().map(|value| {
        let value = value.split_whitespace().collect::<Vec<_>>().join(" ");
        if value.is_empty() { return Err("Each trigger must have keys".into()); }
        if !seen.insert(value.to_lowercase()) { return Err("Each trigger must be unique".into()); }
        Ok(value)
    }).collect()
}

pub fn validate_variables(variables: &[Variable]) -> Result<(), String> {
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for variable in variables {
        let valid_value = match &variable.value {
            VariableValue::Number(value) => value.is_finite(),
            VariableValue::Keys(value) => value.split(|character: char| character.is_whitespace() || character == ',').any(|part| !part.is_empty()),
            VariableValue::Text(_) => true,
            VariableValue::Behavior(source) => !source.trim().is_empty(),
            VariableValue::Triggers(entries) => read_trigger_list(entries).is_ok(),
        };
        if variable.id.trim().is_empty() || !ids.insert(&variable.id)
            || variable.name.trim().is_empty() || !names.insert(variable.name.trim().to_lowercase()) || !valid_value {
            return Err(format!("Invalid or duplicate variable: {}", variable.name));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn typed_variables_and_legacy_numbers_round_trip_without_losing_text() {
        for source in [r#"{"id":"n","name":"Timer","value":5000}"#,
            r#"{"id":"n","name":"Timer","type":"number","value":5000}"#,
            r#"{"id":"t","name":"Message","type":"text","value":"$n; hello\nworld"}"#,
            r#"{"id":"k","name":"Cast","type":"keys","value":"rctrl shift n"}"#,
            r#"{"id":"b","name":"Cast sequence","type":"behavior","value":"press(rctrl n);sleep(150)"}"#,
            r#"{"id":"c","name":"Shortcuts","type":"triggers","value":["lctrl 1","lctrl 2"]}"#] {
            let variable: Variable = serde_json::from_str(source).unwrap();
            validate_variables(std::slice::from_ref(&variable)).unwrap();
            let saved = serde_json::to_value(&variable).unwrap();
            assert!(saved.get("type").is_some());
            assert_eq!(serde_json::from_value::<Variable>(saved).unwrap(), variable);
        }
        for source in [r#"{"id":"n","name":"Bad","type":"number","value":"5000"}"#,
            r#"{"id":"t","name":"Bad","type":"text","value":5}"#,
            r#"{"id":"k","name":"Bad","type":"keys","value":["a","b"]}"#,
            r#"{"id":"c","name":"Bad","type":"triggers","value":"lctrl 1, lctrl 2"}"#,
            r#"{"id":"c","name":"Bad","type":"triggers","value":[]}"#,
            r#"{"id":"c","name":"Bad","type":"triggers","value":[" "]}"#,
            r#"{"id":"c","name":"Bad","type":"triggers","value":[1]}"#,
            r#"{"id":"c","name":"Bad","type":"triggers","value":["lctrl 1"," LCTRL   1 "]}"#] {
            assert!(serde_json::from_str::<Variable>(source).is_err());
        }
    }
}
