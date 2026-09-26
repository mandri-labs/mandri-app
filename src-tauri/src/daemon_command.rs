use std::process::Command;

pub fn configure(command: &mut Command, port: u16) -> &mut Command {
    command
        .args([
            "-I",
            "-m",
            "mandri.daemon",
            "serve",
            "--desktop",
            "--host",
            "127.0.0.1",
            "--port",
        ])
        .arg(port.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_uses_the_backend_default_profile() {
        let mut command = Command::new("synthetic-python");
        configure(&mut command, 43123);
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(
            args,
            [
                "-I",
                "-m",
                "mandri.daemon",
                "serve",
                "--desktop",
                "--host",
                "127.0.0.1",
                "--port",
                "43123",
            ]
        );
    }
}
