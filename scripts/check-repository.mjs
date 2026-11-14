import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z'], { encoding:'utf8' }).split('\0').filter(Boolean);
const findings=[];
for(const file of files) {
  const base=file.split('/').at(-1);
  if ((base.startsWith('.env') && base!=='.env.example') || /\.(sqlite|sqlite3|db)(-|$)|\.(pem|key)$|\.manifest\.json$/.test(base)) findings.push(file+': prohibited sensitive artifact');
  const data=readFileSync(file);
  if(data.includes(0)) continue;
  const content=data.toString('utf8');
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}/.test(content)) findings.push(file+': potential credential pattern');
}
if(findings.length) { console.error(findings.join('\n'));process.exitCode=1; }
else console.log(`PASS: ${files.length} tracked files checked for prohibited artifacts and known credential patterns (not a comprehensive secret audit)`);
