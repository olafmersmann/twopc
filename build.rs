use std::process::Command;

fn main() {
    // Tell Cargo to re-run if your TS files change
    println!("cargo:rerun-if-changed=assets/*.ts");

    let status = Command::new("esbuild")
        .args([
            "assets/app.ts",
            "--bundle",
            "--sourcemap",
            "--target=es2024",
            "--format=esm",
            "--outfile=assets/app.js",
        ])
        .status()
        .expect("Failed to run tsc — is the TypeScript compiler installed?");

    if !status.success() {
        panic!("TypeScript compilation failed");
    }
}
