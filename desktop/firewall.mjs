// Windows Firewall: the console's beacons and packets reach the bridge on UDP; when Windows neither asks nor has a rule
// for the bridge's Python, they are dropped without a word. This builds the one rule the app may add, for that Python
// only, inbound UDP, Private profile, through an elevated (UAC) child the person confirms. Pure; tests/launch.test.ts
// checks the command. The app never runs it without the person's click and Windows' own prompt.
import { isAbsolute } from 'node:path';

export const RULE_NAME = 'DC QA Link Cloud bridge (UDP in, private networks)';
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;   // a PowerShell single-quoted string

/** the rule for this Python (an absolute path to an .exe) */
export function firewallRule(exe) {
  if (!exe || !isAbsolute(exe) || !/\.exe$/i.test(exe)) throw new Error('the bridge\'s Python is not a full path to an .exe: set "Python for the bridge" in Settings first');
  return `New-NetFirewallRule -DisplayName ${psq(RULE_NAME)} -Direction Inbound -Action Allow -Protocol UDP -Profile Private -Program ${psq(exe)} -ErrorAction Stop | Out-Null`;
}

/** the command that runs the rule elevated: a normal PowerShell starts an elevated one (Windows asks), waits, and
 *  passes its exit code back; declining the prompt fails the Start-Process (exit 1) */
export function elevatedRuleCommand(exe) {
  const rule = firewallRule(exe);
  const enc = Buffer.from(rule, 'utf16le').toString('base64');
  const outer = `try { $p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${enc}'; exit $p.ExitCode } catch { exit 1 }`;
  return { rule, file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', outer] };
}

/** a check that needs no elevation: does a rule by this name exist for this program? */
export function ruleCheckCommand(exe) {
  const ps = `$r = Get-NetFirewallRule -DisplayName ${psq(RULE_NAME)} -ErrorAction SilentlyContinue | Where-Object { $_.Enabled -eq 'True' } | Get-NetFirewallApplicationFilter | Where-Object { $_.Program -eq ${psq(exe)} }; if ($r) { exit 0 } else { exit 3 }`;
  return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', ps] };
}
