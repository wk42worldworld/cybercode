use std::{ffi::OsStr, process::Command};

/// Background probes must not allocate a Windows console, including when the
/// parent is a GUI executable. Redirecting stdout/stderr alone is insufficient.
pub fn background_command(program: impl AsRef<OsStr>) -> Command {
    let command = Command::new(program);
    #[cfg(windows)]
    let command = {
        use std::os::windows::process::CommandExt;
        let mut command = command;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        command
    };
    command
}

#[cfg(all(test, windows))]
mod tests {
    use super::background_command;

    #[test]
    fn powershell_runs_without_a_console_and_preserves_output() {
        let output = background_command("powershell.exe")
            .args([
                "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
                r#"Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ConsoleProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'; [Console]::Write([ConsoleProbe]::GetConsoleWindow().ToInt64()); [Console]::Error.Write('probe stderr'); exit 7"#,
            ])
            .output()
            .expect("PowerShell should start");
        assert_eq!(output.status.code(), Some(7));
        assert_eq!(String::from_utf8_lossy(&output.stdout), "0");
        assert_eq!(String::from_utf8_lossy(&output.stderr), "probe stderr");
    }
}
