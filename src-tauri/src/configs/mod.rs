use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub unsplash_client_id: String,
}

impl Config {
    pub fn load() -> Self {
        dotenv::dotenv().ok();

        let unsplash_client_id =
            env::var("UNSPLASH_CLIENT_ID").expect("UNSPLASH_CLIENT_ID must be set in .env");

        Self { unsplash_client_id }
    }
}
