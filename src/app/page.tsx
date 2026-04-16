"use client";

import { useState, useEffect } from "react";
import * as ohm from "ohm-js";

// --- Dia+ のデータ構造定義 ---
interface PositionData {
  name: string;
  position: { x: number; y: number };
}

interface FrameData {
  type: "frame";
  id: string;
  positions: PositionData[];
  sectionName?: string;
}

interface SectionData {
  type: "section";
  name: string;
  frames: FrameData[];
}

type ElementData = SectionData | FrameData;

// 新しく追加する「メンバー」と「カラー」の中間データ型
type GroupBodyData =
  | { type: "members"; data: string[] }
  | { type: "colors"; data: string[] }
  | ElementData;

// 最終出力データにグループ情報を追加
interface DiaPlusData {
  mode: "time" | "measure";
  music?: string;
  groupName: string;
  members: string[];
  colors: string[];
  frames: FrameData[];
}

// Ohm.jsの文法定義
const grammar = ohm.grammar(`
  Diaplus {
    Program = Mode Music? Group

    Mode = "mode" ("time" | "measure")
    Music = "music" "(" String ")"

    Group = "group" "(" String ")" "{" GroupBody* "}"
    GroupBody = Members | Colors | Element

    Members = "members" ":" Array
    Colors = "colors" ":" Array
    Array = "[" ListOf<String, ","> "]"

    Element = Section | Frame
    Section = "section" String "{" Frame* "}"
    Frame = "frame" "@" FrameId "{" Formation "}"

    FrameId = Time | number

    Formation = Position*
    Position = MemberName ":" Coordinate

    Coordinate = "(" number "," number ")"
    MemberName = String

    Time = digit+ ":" digit+
    String = "\\"" (~"\\"" any)* "\\""
    number = "-"? digit+ ("." digit+)?
  }
`);

const semantics = grammar.createSemantics();
semantics.addOperation("toJSON", {
  _iter(...children) {
    return children.map((c) => c.toJSON());
  },
  _terminal() {
    return this.sourceString;
  },

  // プログラム全体の処理
  Program(mode: ohm.Node, optMusic: ohm.Node, group: ohm.Node) {
    const parsedGroup = group.toJSON();
    const musicNode = optMusic.children[0];
    const musicPath = musicNode ? musicNode.toJSON() : undefined;

    return {
      mode: mode.toJSON() as "time" | "measure",
      music: musicPath,
      ...parsedGroup, // groupName, members, colors, frames を展開
    };
  },

  Music(
    _music: ohm.Node,
    _lparen: ohm.Node,
    path: ohm.Node,
    _rparen: ohm.Node,
  ) {
    return path.toJSON();
  },

  Group(
    _group: ohm.Node,
    _lparen: ohm.Node,
    name: ohm.Node,
    _rparen: ohm.Node,
    _lbrace: ohm.Node,
    body: ohm.Node,
    _rbrace: ohm.Node,
  ) {
    const frames: FrameData[] = [];
    let members: string[] = [];
    let colors: string[] = [];

    // グループ内の要素を振り分ける
    body.children.forEach((b: ohm.Node) => {
      const parsed = b.toJSON() as GroupBodyData;
      if (parsed.type === "members") members = parsed.data;
      else if (parsed.type === "colors") colors = parsed.data;
      else if (parsed.type === "section") {
        parsed.frames.forEach((f: FrameData) => {
          frames.push({ ...f, sectionName: parsed.name });
        });
      } else if (parsed.type === "frame") {
        frames.push(parsed);
      }
    });

    // フレームのソート
    frames.sort((a, b) => {
      const parseTime = (id: string): number => {
        if (id.includes(":")) {
          const [min, sec] = id.split(":").map(Number);
          return min * 60 + sec;
        }
        return parseFloat(id);
      };
      return parseTime(a.id) - parseTime(b.id);
    });

    return {
      groupName: name.toJSON(),
      members,
      colors,
      frames,
    };
  },

  Members(_members: ohm.Node, _colon: ohm.Node, array: ohm.Node) {
    return { type: "members", data: array.toJSON() };
  },

  Colors(_colors: ohm.Node, _colon: ohm.Node, array: ohm.Node) {
    return { type: "colors", data: array.toJSON() };
  },

  // ListOf を使ったカンマ区切り配列の処理
  Array(_lbracket: ohm.Node, list: ohm.Node, _rbracket: ohm.Node) {
    return list.asIteration().children.map((c: ohm.Node) => c.toJSON());
  },

  // --- 既存のルール ---
  Mode(_mode: ohm.Node, type: ohm.Node) {
    return type.sourceString;
  },
  Element(elements: ohm.Node) {
    return elements.toJSON();
  },
  Section(
    _sec: ohm.Node,
    name: ohm.Node,
    _open: ohm.Node,
    frames: ohm.Node,
    _close: ohm.Node,
  ) {
    return { type: "section", name: name.toJSON(), frames: frames.toJSON() };
  },
  Frame(
    _frame: ohm.Node,
    _at: ohm.Node,
    id: ohm.Node,
    _open: ohm.Node,
    formation: ohm.Node,
    _close: ohm.Node,
  ) {
    return {
      type: "frame",
      id: id.sourceString,
      positions: formation.toJSON(),
    };
  },
  Formation(positions: ohm.Node) {
    return positions.toJSON();
  },
  Position(membername: ohm.Node, _colon: ohm.Node, coord: ohm.Node) {
    return { name: membername.toJSON(), position: coord.toJSON() };
  },
  Coordinate(
    _lparen: ohm.Node,
    x: ohm.Node,
    _comma: ohm.Node,
    y: ohm.Node,
    _rparen: ohm.Node,
  ) {
    return { x: parseFloat(x.sourceString), y: parseFloat(y.sourceString) };
  },
  String(_rdouble: ohm.Node, chars: ohm.Node, _ldouble: ohm.Node) {
    return chars.sourceString;
  },
});

// メインの画面コンポーネント
export default function Home() {
  // ✨ ステージのサイズとスケールを「定数」として一括管理
  const STAGE_WIDTH = 800; // 横幅を広げて8人入るように！
  const STAGE_HEIGHT = 600;
  const CENTER_X = STAGE_WIDTH / 2; // 中心は絶対 400 になる
  const CENTER_Y = STAGE_HEIGHT / 2; // 中心は絶対 300 になる
  const SCALE = 45; // 8人が綺麗に収まるように少しだけ倍率を調整

  // ... (以降の useState などはそのまま)

  const [fileName, setFileName] = useState("ファイルが選択されていません");
  const [fileContent, setFileContent] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const [parsedData, setParsedData] = useState<DiaPlusData | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);

  // ✨ 追加機能1：再生状態の管理
  const [isPlaying, setIsPlaying] = useState(false);

  // ✨ 追加機能2：全フレームの「累積状態」を保存する配列
  const [timelineStates, setTimelineStates] = useState<PositionData[][]>([]);

  // ファイル読み込み処理
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setFileContent(e.target?.result as string);
    reader.readAsText(file);
  };

  // コンパイル（構文解析）処理
  useEffect(() => {
    if (!fileContent) return;
    const matchResult = grammar.match(fileContent);
    if (matchResult.succeeded()) {
      setErrorMsg("");
      try {
        const data = semantics(matchResult).toJSON() as DiaPlusData;
        setParsedData(data);
        setCurrentFrameIndex(0);
        setIsPlaying(false); // 読み込んだ時は停止状態にする
      } catch (err: any) {
        setErrorMsg("変換エラー: " + err.message);
      }
    } else {
      setErrorMsg((matchResult as any).message);
    }
  }, [fileContent]);

  // ✨ 省略ルールの裏側：前のフレームの状態を引き継ぐ処理
  useEffect(() => {
    if (!parsedData) return;

    const states: PositionData[][] = [];
    const currentState: Record<string, PositionData> = {};

    parsedData.frames.forEach((frame) => {
      // そのフレームで動くメンバーの座標を上書き（動かない人はそのまま残る）
      frame.positions.forEach((p) => {
        currentState[p.name] = p;
      });
      // そのフレーム時点での「全メンバーの最新状態」を保存
      states.push(Object.values(currentState));
    });

    setTimelineStates(states);
  }, [parsedData]);

  // ✨ 再生ボタンのタイマー処理（動画のような滑らかな動き）
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying && timelineStates.length > 0) {
      interval = setInterval(() => {
        setCurrentFrameIndex((prev) => {
          // 最後のフレームまで来たら自動で停止する
          if (prev >= timelineStates.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1; // 次のフレームへ
        });
      }, 1000); // 1秒（1000ms）ごとに次のフレームへ進む
    }
    return () => clearInterval(interval);
  }, [isPlaying, timelineStates.length]);

  // 再生ボタンを押した時の処理
  const togglePlay = () => {
    // 最後まで進んでいる状態で再生を押したら、最初に戻す
    if (!isPlaying && currentFrameIndex >= timelineStates.length - 1) {
      setCurrentFrameIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  // 現在の画面に表示するメンバーの座標リスト
  const currentPositions = timelineStates[currentFrameIndex] || [];

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#222",
        color: "white",
      }}
    >
      {/* 左半分：エディタ＆情報エリア */}
      <div
        style={{
          flex: 1,
          padding: "30px",
          borderRight: "1px solid #444",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2>Dia+ Simulator</h2>
        <input
          type="file"
          accept=".diap,.txt"
          onChange={handleFileUpload}
          style={{
            padding: "10px",
            backgroundColor: "#333",
            border: "1px solid #555",
            borderRadius: "5px",
          }}
        />

        {errorMsg && (
          <div
            style={{
              color: "#ff6b6b",
              marginTop: "20px",
              whiteSpace: "pre-wrap",
              backgroundColor: "#3a1c1c",
              padding: "10px",
            }}
          >
            {errorMsg}
          </div>
        )}

        {/* タイムラインコントローラー */}
        {parsedData && timelineStates.length > 0 && (
          <div
            style={{
              marginTop: "auto",
              padding: "20px",
              backgroundColor: "#111",
              borderRadius: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "10px",
              }}
            >
              <h3>Timeline</h3>

              {/* ✨ 再生・一時停止ボタン */}
              <button
                onClick={togglePlay}
                style={{
                  padding: "10px 20px",
                  fontSize: "16px",
                  fontWeight: "bold",
                  backgroundColor: isPlaying ? "#ff4757" : "#2ed573",
                  border: "none",
                  borderRadius: "5px",
                  color: "white",
                  cursor: "pointer",
                  transition: "background-color 0.2s",
                }}
              >
                {isPlaying ? "⏸ 一時停止" : "▶ 再生"}
              </button>
            </div>

            <input
              type="range"
              min="0"
              max={timelineStates.length - 1}
              value={currentFrameIndex}
              onChange={(e) => {
                setCurrentFrameIndex(parseInt(e.target.value));
                setIsPlaying(false); // 手動で動かした時は一時停止する
              }}
              style={{ width: "100%", cursor: "pointer" }}
            />

            <div
              style={{
                textAlign: "center",
                marginTop: "10px",
                fontSize: "18px",
                fontWeight: "bold",
              }}
            >
              <span style={{ color: "#00d2ff", marginRight: "10px" }}>
                {parsedData.frames[currentFrameIndex]?.sectionName
                  ? `[${parsedData.frames[currentFrameIndex].sectionName}]`
                  : ""}
              </span>
              {parsedData.mode === "measure" ? "小節" : "時間"} @
              {parsedData.frames[currentFrameIndex]?.id}
            </div>
          </div>
        )}
      </div>

      {/* 右半分：ステージ */}
      <div
        style={{
          flex: 1,
          padding: "20px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        <svg
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          style={{
            backgroundColor: "#111",
            border: "1px solid #555",
            borderRadius: "10px",
          }}
        >
          {/* ✨ センターライン（絶対に中心になる計算） */}
          <line
            x1={CENTER_X}
            y1="0"
            x2={CENTER_X}
            y2={STAGE_HEIGHT}
            stroke="#444"
            strokeDasharray="5,5"
          />
          <line
            x1="0"
            y1={CENTER_Y}
            x2={STAGE_WIDTH}
            y2={CENTER_Y}
            stroke="#444"
            strokeDasharray="5,5"
          />

          {currentPositions.map((member: any) => {
            if (!member || !member.position) return null;

            const memberIndex = parsedData?.members?.indexOf(member.name) ?? -1;
            const circleColor =
              memberIndex !== -1 && parsedData?.colors?.[memberIndex]
                ? parsedData.colors[memberIndex]
                : "#8e44ad";

            // ✨ メンバーの座標も、絶対的な中心点（CENTER）から計算する！
            const screenX = CENTER_X + member.position.x * SCALE;
            const screenY = CENTER_Y - member.position.y * SCALE;

            return (
              <g
                key={member.name}
                transform={`translate(${screenX}, ${screenY})`}
                style={{ transition: "transform 1s ease-in-out" }}
              >
                <circle
                  r="15"
                  fill={circleColor}
                  stroke="#fff"
                  strokeWidth="2"
                />
                <text
                  y="-22"
                  fill="white"
                  textAnchor="middle"
                  fontSize="14"
                  fontWeight="bold"
                >
                  {member.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
