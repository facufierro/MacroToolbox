use serde::{Deserialize, Serialize};
use crate::variables::{read_trigger_list, Variable, VariableReference, VariableValue};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum Trigger { Literal(String), Variable(VariableReference) }

impl From<&str> for Trigger {
    fn from(value: &str) -> Self { Self::Literal(value.into()) }
}
impl From<String> for Trigger {
    fn from(value: String) -> Self { Self::Literal(value) }
}

impl Trigger {
    pub fn resolve(&self, variables: &[Variable]) -> Result<Vec<String>, String> {
        match self {
            Self::Literal(value) => Ok(if value.trim().is_empty() { Vec::new() } else { vec![value.clone()] }),
            Self::Variable(reference) => {
                let variable = variables.iter().find(|variable| variable.id == reference.variable)
                    .ok_or_else(|| format!("Missing trigger list variable: {}", reference.variable))?;
                match &variable.value {
                    VariableValue::Triggers(entries) => read_trigger_list(entries),
                    _ => Err(format!("{} must be a Trigger list variable", variable.name)),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_and_variable_sources_round_trip_and_require_a_trigger_list() {
        let literal: Trigger = serde_json::from_str(r#""lctrl 1""#).unwrap();
        assert_eq!(literal.resolve(&[]).unwrap(), ["lctrl 1"]);
        assert_eq!(serde_json::to_value(&literal).unwrap(), "lctrl 1");
        assert!(Trigger::from("").resolve(&[]).unwrap().is_empty());
        let source = serde_json::json!({"variable":"casts"});
        let trigger: Trigger = serde_json::from_value(source.clone()).unwrap();
        let mut variable: Variable = serde_json::from_value(serde_json::json!({
            "id":"casts","name":"Cast shortcuts","type":"triggers","value":["  lctrl   1 ","lctrl 2","lctrl 3"]
        })).unwrap();
        assert_eq!(trigger.resolve(std::slice::from_ref(&variable)).unwrap(), ["lctrl 1","lctrl 2","lctrl 3"]);
        assert_eq!(serde_json::to_value(&trigger).unwrap(), source);
        assert!(trigger.resolve(&[]).is_err());
        variable.value = VariableValue::Keys("lctrl 1".into());
        assert!(trigger.resolve(&[variable]).is_err());
        for source in [serde_json::json!({"source":"trigger"}), serde_json::json!({"variable":"casts","extra":true})] {
            assert!(serde_json::from_value::<Trigger>(source).is_err());
        }
    }
}
