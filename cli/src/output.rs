use serde_json::Value;

pub fn print_result(value: &Value, json: bool) {
    if json {
        println!(
            "{}",
            serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
        );
        return;
    }

    // Human-readable output
    match value {
        Value::Array(items) => {
            if items.is_empty() {
                println!("(none)");
                return;
            }
            for item in items {
                print_object(item);
                println!();
            }
        }
        Value::Object(_) => {
            print_object(value);
        }
        _ => {
            println!("{value}");
        }
    }
}

fn print_object(value: &Value) {
    if let Value::Object(map) = value {
        for (key, val) in map {
            match val {
                Value::String(s) => println!("  {key}: {s}"),
                Value::Null => println!("  {key}: -"),
                Value::Array(arr) => println!("  {key}: [{} items]", arr.len()),
                Value::Object(_) => println!("  {key}: {{...}}"),
                other => println!("  {key}: {other}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn format_empty_array_prints_none() {
        // Just verify it doesn't panic
        print_result(&json!([]), false);
    }

    #[test]
    fn format_object_prints_fields() {
        // Just verify it doesn't panic
        print_result(&json!({"name": "test", "id": "123"}), false);
    }

    #[test]
    fn format_json_mode() {
        // Just verify it doesn't panic
        print_result(&json!({"name": "test"}), true);
    }

    #[test]
    fn format_scalar_value() {
        // Just verify it doesn't panic
        print_result(&json!(42), false);
    }

    #[test]
    fn format_array_of_objects() {
        // Just verify it doesn't panic
        print_result(
            &json!([{"id": "1", "name": "ws1"}, {"id": "2", "name": "ws2"}]),
            false,
        );
    }

    #[test]
    fn format_object_with_null_field() {
        // Just verify it doesn't panic
        print_result(&json!({"name": "test", "extra": null}), false);
    }

    #[test]
    fn format_object_with_nested_array() {
        // Just verify it doesn't panic
        print_result(&json!({"items": [1, 2, 3]}), false);
    }

    #[test]
    fn format_object_with_nested_object() {
        // Just verify it doesn't panic
        print_result(&json!({"nested": {"a": 1}}), false);
    }
}
