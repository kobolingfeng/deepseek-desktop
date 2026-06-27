import { shell } from '../api';

// Lightweight, key-less, offline speech-to-text using Windows' built-in
// System.Speech recognizer via PowerShell (WebView2 can't use the Web Speech API).
// One-shot: listens until an utterance completes or ~12s, returns the text.
export async function nativeListen(lang: 'en' | 'zh'): Promise<string> {
  const culture = lang === 'zh' ? 'zh-CN' : 'en-US';
  const ps = [
    'Add-Type -AssemblyName System.Speech;',
    `$c='${culture}';`,
    '$ri=[System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()' +
      ' | Where-Object { $_.Culture.Name -eq $c } | Select-Object -First 1;',
    '$r = if ($ri) { New-Object System.Speech.Recognition.SpeechRecognitionEngine($ri) }' +
      ' else { New-Object System.Speech.Recognition.SpeechRecognitionEngine };',
    '$r.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar));',
    '$r.SetInputToDefaultAudioDevice();',
    '$res=$r.Recognize([TimeSpan]::FromSeconds(12));',
    '$r.Dispose();',
    'if ($res) { [Console]::Out.Write($res.Text) }',
  ].join(' ');
  const r = await shell.run('powershell', ['-NoProfile', '-Command', ps]);
  return (r.stdout || '').trim();
}
