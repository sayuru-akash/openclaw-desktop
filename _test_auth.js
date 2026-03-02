const { execFileSync } = require("child_process");

function runInWsl(cmd) {
  const encoded = Buffer.from(cmd, "utf8").toString("base64");
  const sp = `/tmp/_oc_test_${Date.now()}.sh`;
  execFileSync("wsl.exe", ["-d", "Ubuntu", "--", "bash", "-c",
    `echo ${encoded} | base64 -d > ${sp} && chmod +x ${sp}`],
    { encoding: "utf8", timeout: 15000 });
  try {
    return execFileSync("wsl.exe", ["-d", "Ubuntu", "-u", "sewni", "--", "bash", "-l", sp],
      { encoding: "utf8", timeout: 30000 });
  } catch (e) {
    return `EXIT ${e.status}\nSTDOUT: ${e.stdout?.toString()}\nSTDERR: ${e.stderr?.toString()}`;
  } finally {
    try { execFileSync("wsl.exe", ["-d", "Ubuntu", "--", "rm", "-f", sp], { timeout: 5000 }); } catch {}
  }
}

const cli = "$HOME/.openclaw-desktop/npm/bin/openclaw";

console.log("=== models auth --help ===");
console.log(runInWsl(`${cli} models auth --help 2>&1`));

console.log("\n=== models auth list --help ===");
console.log(runInWsl(`${cli} models auth list 2>&1 || ${cli} models auth --help 2>&1`));

console.log("\n=== models status --json ===");
console.log(runInWsl(`${cli} models status --json 2>&1`));
