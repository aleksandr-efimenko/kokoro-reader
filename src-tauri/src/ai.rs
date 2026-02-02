use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri_plugin_opener::OpenerExt;

#[derive(Serialize)]
struct ExplainRequest {
    text: String,
    context: String,
}

#[derive(Deserialize)]
struct ExplainResponse {
    result: Option<String>,
    error: Option<String>,
}

/// Open the default browser to the Text Clarifier auth page.
/// The website will redirect back to `textclarifier://auth?token=xxx`
/// which is handled by the deep-link plugin in lib.rs.
#[tauri::command]
pub async fn open_auth_window(app: tauri::AppHandle) -> Result<(), String> {
    // The callback URL that textclarifier.com should redirect to
    let callback_url = "textclarifier://auth";
    let auth_url = format!(
        "https://textclarifier.com/dashboard/connect-app?callback={}",
        urlencoding::encode(callback_url)
    );

    // Open in default system browser
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn explain_text(
    api_key: String,
    text: String,
    context: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.textclarifier.com/clarify")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&ExplainRequest { text, context })
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API Error: {}", res.status()));
    }

    let body = res
        .json::<ExplainResponse>()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if let Some(error) = body.error {
        return Err(error);
    }

    body.result
        .ok_or_else(|| "No explanation returned".to_string())
}
