pub fn leer_config() -> String {
    std::env::var("GLORY_CONFIG").unwrap()
}