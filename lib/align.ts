/**
 * ①LRC自動生成の心臓部:
 * 「正解の歌詞（行）」を、音声認識が返した「単語＋時刻」の列に割り付ける。
 * 認識ミスがあっても、正解テキストを知っている前提の文字列アライメント
 * （編集距離のDP）なので頑健。答えを見ながらページ番号を探す方式。
 */

export interface RecognizedWord {
  text: string;
  start: number; // 秒
  end: number;
}

export interface AlignedLine {
  text: string;
  start: number | null; // null = 割り付け失敗（後で補間）
}

/** 表記ゆれを吸収する正規化: NFKC → カタカナ→ひらがな → 記号除去 */
export function normalizeJa(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60),
    )
    .replace(/[^ぁ-んー一-龯a-z0-9]/g, "");
}

export interface AlignedLineWord {
  text: string; // lyricText 内の該当部分
  start: number; // 秒（認識単語の開始）
  end: number;
  charFrom: number; // 表示文字index（両端含む）
  charTo: number;
}

export interface AlignedLineDetailed extends AlignedLine {
  words: AlignedLineWord[];
}

/**
 * 歌詞行 → 開始時刻（従来API）。
 * 1) 認識単語列を1本の正規化文字列 S に連結（各文字→単語番号の対応表つき）
 * 2) 歌詞行も連結して T に
 * 3) S×T の編集距離DP＋トレースバックで T の各文字を S の文字に対応づけ
 * 4) 行の先頭数文字の対応先の単語時刻から行の開始時刻を得る
 */
export function alignLyricsToWords(
  lyricLines: string[],
  words: RecognizedWord[],
): AlignedLine[] {
  return alignLyricsDetailed(lyricLines, words).map(({ text, start }) => ({
    text,
    start,
  }));
}

/**
 * 詳細版: 行の開始時刻に加えて、行内の「表示文字range → 認識単語の時刻」の
 * 対応（単語タイムスタンプ）も返す。カラオケ塗りの単語精度化・単語ごと出現の土台。
 */
export function alignLyricsDetailed(
  lyricLines: string[],
  words: RecognizedWord[],
): AlignedLineDetailed[] {
  const wordChars: { ch: string; wordIndex: number }[] = [];
  words.forEach((w, wi) => {
    for (const ch of normalizeJa(w.text)) wordChars.push({ ch, wordIndex: wi });
  });
  const S = wordChars.map((c) => c.ch).join("");

  const lineRanges: { start: number; end: number }[] = [];
  let T = "";
  for (const line of lyricLines) {
    const norm = normalizeJa(line);
    lineRanges.push({ start: T.length, end: T.length + norm.length });
    T += norm;
  }

  if (S.length === 0 || T.length === 0) {
    return lyricLines.map((text) => ({ text, start: null, words: [] }));
  }

  // 編集距離DP（|S|×|T|）。数千×数千なら余裕
  const n = S.length;
  const m = T.length;
  const cols = m + 1;
  const dp = new Int32Array((n + 1) * cols);
  for (let j = 0; j <= m; j++) dp[j] = j;
  for (let i = 1; i <= n; i++) {
    dp[i * cols] = i;
    for (let j = 1; j <= m; j++) {
      const cost = S[i - 1] === T[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(
        dp[(i - 1) * cols + j] + 1,
        dp[i * cols + j - 1] + 1,
        dp[(i - 1) * cols + j - 1] + cost,
      );
    }
  }

  // トレースバック: T[j] → S[i] の対応
  const tToS = new Int32Array(m).fill(-1);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const cur = dp[i * cols + j];
    const diagCost = S[i - 1] === T[j - 1] ? 0 : 1;
    if (cur === dp[(i - 1) * cols + j - 1] + diagCost) {
      if (diagCost === 0) tToS[j - 1] = i - 1;
      i--;
      j--;
    } else if (cur === dp[(i - 1) * cols + j] + 1) {
      i--;
    } else {
      j--;
    }
  }

  // 各行: 先頭側で最初に対応が取れた文字の単語時刻を採用
  const result: AlignedLineDetailed[] = lyricLines.map((text, li) => {
    const { start, end } = lineRanges[li];
    let lineStart: number | null = null;
    for (let k = start; k < Math.min(end, start + 8); k++) {
      const si = tToS[k];
      if (si >= 0) {
        lineStart = words[wordChars[si].wordIndex].start;
        break;
      }
    }
    return { text, start: lineStart, words: buildLineWords(text, li) };
  });

  /**
   * 行の表示文字を認識単語に割り付ける。
   * 表示文字を歩きながら（正規化で消える記号は直前の単語に吸収）、
   * 連続して同じ単語に対応する文字をまとめて1チャンクにする。
   */
  function buildLineWords(text: string, li: number): AlignedLineWord[] {
    const chars = [...text];
    // 表示文字ごとの対応単語index（-1=不明）
    const charWord = new Array<number>(chars.length).fill(-1);
    let k = lineRanges[li].start; // 正規化文字列T内の現在位置
    for (let d = 0; d < chars.length; d++) {
      const norm = normalizeJa(chars[d]);
      if (norm.length === 0) continue; // 記号・空白（Tに存在しない）
      // NFKCで複数文字に展開されるケースは最初の対応を採る
      for (let c = 0; c < norm.length; c++) {
        const si = tToS[k];
        if (si >= 0 && charWord[d] === -1) charWord[d] = wordChars[si].wordIndex;
        k++;
      }
    }
    // 不明文字は直前（先頭なら直後）の単語に吸収
    for (let d = 0; d < chars.length; d++) {
      if (charWord[d] === -1 && d > 0) charWord[d] = charWord[d - 1];
    }
    for (let d = chars.length - 2; d >= 0; d--) {
      if (charWord[d] === -1) charWord[d] = charWord[d + 1];
    }
    // 連続する同一単語をチャンク化
    const out: AlignedLineWord[] = [];
    let from = 0;
    for (let d = 1; d <= chars.length; d++) {
      if (d === chars.length || charWord[d] !== charWord[from]) {
        const wi = charWord[from];
        if (wi >= 0) {
          out.push({
            text: chars.slice(from, d).join(""),
            start: words[wi].start,
            end: words[wi].end,
            charFrom: from,
            charTo: d - 1,
          });
        }
        from = d;
      }
    }
    // 時刻の単調増加を保証（ASRの誤対応で逆行したチャンクはクランプ）
    for (let idx = 1; idx < out.length; idx++) {
      if (out[idx].start < out[idx - 1].start) {
        out[idx].start = out[idx - 1].start + 0.01;
      }
      if (out[idx].end < out[idx].start) out[idx].end = out[idx].start;
    }
    return out;
  }

  // 失敗した行は前後から補間、単調増加を保証
  for (let li = 0; li < result.length; li++) {
    if (result[li].start === null) {
      const prev = [...result.slice(0, li)].reverse().find((r) => r.start !== null);
      const next = result.slice(li + 1).find((r) => r.start !== null);
      if (prev?.start != null && next?.start != null) {
        const prevIdx = result.indexOf(prev);
        const nextIdx = result.indexOf(next);
        const ratio = (li - prevIdx) / (nextIdx - prevIdx);
        result[li].start = prev.start + (next.start - prev.start) * ratio;
      } else if (prev?.start != null) {
        result[li].start = prev.start + 2;
      } else if (next?.start != null) {
        result[li].start = Math.max(0, next.start - 2);
      } else {
        result[li].start = li * 3;
      }
    }
  }
  for (let li = 1; li < result.length; li++) {
    const prev = result[li - 1].start ?? 0;
    if ((result[li].start ?? 0) <= prev) {
      result[li].start = prev + 0.5;
    }
  }
  return result;
}
