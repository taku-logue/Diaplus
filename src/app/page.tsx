"use client";

import { useState, useEffect } from "react";
// 1. 完全版の文法定義（Grammar）
import * as ohm from "ohm-js";

// --- 型定義 ---
interface PositionData {
  name: string;
  position: { x: number; y: number };
}
interface ShapeData {
  type: "line";
  params: Record<string, any>;
  origin: { x: number; y: number };
}
interface FrameData {
  type: "frame";
  id: string;
  transition?: number;
  positions?: PositionData[];
  shape?: ShapeData;
  sectionName?: string;
}
interface DiaPlusData {
  mode: "time" | "measure";
  music?: string;
  groupName: string;
  members: string[];
  colors: string[];
  frames: FrameData[];
}

// ✨ 内部ライブラリ（ShapeLibrary）の誕生！
// 将来的にファイル分割する時は、このブロックだけを切り出せばOKです。
const ShapeLibrary: Record<string, Function> = {
  line: (members: string[], params: any, origin: { x: number; y: number }) => {
    const spacing = params.spacing !== undefined ? params.spacing : 2;
    // orderが指定されていなければ、1〜メンバー全員分の配列を自動生成
    const order: number[] = params.order || members.map((_, i) => i + 1);

    const result: PositionData[] = [];
    const count = order.length;

    order.forEach((memberIndex, i) => {
      const name = members[memberIndex - 1]; // 1始まりの番号を0始まりの配列に変換
      if (!name) return; // 存在しない番号は無視

      // originを中心として、左右に展開する数式
      const offsetX = (i - (count - 1) / 2) * spacing;
      result.push({
        name,
        position: { x: origin.x + offsetX, y: origin.y },
      });
    });
    return result;
  },
};

// --- 文法定義 ---
const grammar = ohm.grammar(`
  Diaplus {
    Program = Mode Music? Group
    Mode = "mode" ("time" | "measure")
    Music = "music" "(" String ")"
    Group = "group" "(" String ")" "{" GroupBody* "}"
    GroupBody = Members | Colors | Element
    Members = "members" ":" StringArray
    Colors = "colors" ":" StringArray
    StringArray = "[" ListOf<String, ","> "]"

    Element = Section | Frame
    Section = "section" String "{" Frame* "}"
    
    // ✨ 変更：Shape か Formation を選べる
    Frame = "frame" "@" FrameId "{" Transition? (Shape | Formation) "}"
    
    // ✨ 追加：shape: line(spacing: 2, order: [1,3,2]) : (0,0)
    Shape = "shape" ":" ShapeName "(" ListOf<ShapeParam, ","> ")" ":" Coordinate
    ShapeName = "line" // 今回はlineのみ
    ShapeParam = identifier ":" (NumArray | NumberVal)
    NumArray = "[" ListOf<NumberVal, ","> "]"
    NumberVal = number

    Transition = "transition" ":" number
    FrameId = Time | number
    Formation = Position*
    Position = MemberName ":" Coordinate
    Coordinate = "(" number "," number ")"
    MemberName = String
    Time = digit+ ":" digit+
    String = "\\"" (~"\\"" any)* "\\""
    number = "-"? digit+ ("." digit+)?
    identifier = letter (letter | digit)*
  }
`);

// --- 変換ルール ---
const semantics = grammar.createSemantics();
semantics.addOperation("toJSON", {
  _iter(...children) {
    return children.map((c) => c.toJSON());
  },
  _terminal() {
    return this.sourceString;
  },

  Program(mode, optMusic, group) {
    return {
      mode: mode.toJSON(),
      music: optMusic.children[0]?.toJSON(),
      ...group.toJSON(),
    };
  },
  Music(_music, _lparen, path, _rparen) {
    return path.toJSON();
  },
  Group(_group, _lparen, name, _rparen, _lbrace, body, _rbrace) {
    const frames: any[] = [];
    let members: string[] = [];
    let colors: string[] = [];
    body.children.forEach((b: any) => {
      const parsed = b.toJSON();
      if (parsed.type === "members") members = parsed.data;
      else if (parsed.type === "colors") colors = parsed.data;
      else if (parsed.type === "section")
        parsed.frames.forEach((f: any) =>
          frames.push({ ...f, sectionName: parsed.name }),
        );
      else if (parsed.type === "frame") frames.push(parsed);
    });
    frames.sort((a, b) => {
      const pT = (id: string) =>
        id.includes(":")
          ? id
              .split(":")
              .map(Number)
              .reduce((m, s) => m * 60 + s)
          : parseFloat(id);
      return pT(a.id) - pT(b.id);
    });
    return { groupName: name.toJSON(), members, colors, frames };
  },
  Members(_members, _colon, arr) {
    return { type: "members", data: arr.toJSON() };
  },
  Colors(_colors, _colon, arr) {
    return { type: "colors", data: arr.toJSON() };
  },
  StringArray(_l, list, _r) {
    return list.asIteration().children.map((c: any) => c.toJSON());
  },

  // ✨ Shape関連の変換処理
  Shape(_shape, _colon, name, _lparen, params, _rparen, _colon2, coord) {
    const pList = params.asIteration().children.map((p) => p.toJSON());
    return {
      type: name.sourceString,
      params: Object.fromEntries(pList.map((p) => [p.key, p.val])),
      origin: coord.toJSON(),
    };
  },
  ShapeParam(id, _colon, val) {
    return { key: id.sourceString, val: val.toJSON() };
  },
  NumArray(_l, list, _r) {
    return list.asIteration().children.map((c) => c.toJSON());
  },
  NumberVal(num) {
    return parseFloat(num.sourceString);
  },

  Mode(_mode, type) {
    return type.sourceString;
  },
  Element(e) {
    return e.toJSON();
  },
  Section(_sec, name, _open, frames, _close) {
    return { type: "section", name: name.toJSON(), frames: frames.toJSON() };
  },
  Transition(_trans, _colon, num) {
    return parseFloat(num.sourceString);
  },

  Frame(_frame, _at, id, _open, optTrans, content, _close) {
    const trans = optTrans.children[0]?.toJSON();
    const parsed = content.toJSON();
    // Shape(オブジェクト)か、Formation(配列)かで振り分ける
    return {
      type: "frame",
      id: id.sourceString,
      transition: trans,
      positions: Array.isArray(parsed) ? parsed : undefined,
      shape: !Array.isArray(parsed) ? parsed : undefined,
    };
  },
  Formation(pos) {
    return pos.toJSON();
  },
  Position(name, _colon, coord) {
    return { name: name.toJSON(), position: coord.toJSON() };
  },
  Coordinate(_l, x, _c, y, _r) {
    return { x: parseFloat(x.sourceString), y: parseFloat(y.sourceString) };
  },
  String(_ld, chars, _rd) {
    return chars.sourceString;
  },
});

// メインの画面コンポーネント
export default function Home() {
  const STAGE_WIDTH = 800;
  const STAGE_HEIGHT = 600;
  const CENTER_X = STAGE_WIDTH / 2;
  const CENTER_Y = STAGE_HEIGHT / 2;
  const SCALE = 45;

  const [fileName, setFileName] = useState("ファイルが選択されていません");
  const [fileContent, setFileContent] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [parsedData, setParsedData] = useState<DiaPlusData | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [maxTime, setMaxTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [richTimeline, setRichTimeline] = useState<any[]>([]);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setFileContent(e.target?.result as string);
    reader.readAsText(file);
  };

  useEffect(() => {
    if (!fileContent) return;
    const matchResult = grammar.match(fileContent);
    if (matchResult.succeeded()) {
      setErrorMsg("");
      try {
        const data = semantics(matchResult).toJSON() as DiaPlusData;
        setParsedData(data);
      } catch (err: any) {
        setErrorMsg("変換エラー: " + err.message);
      }
    } else {
      setErrorMsg((matchResult as any).message);
    }
  }, [fileContent]);

  // ✨ ロジック修正：フレーム間の時間をフルに使ったタイムラインの構築
  useEffect(() => {
    if (!parsedData || parsedData.frames.length === 0) return;

    const parseTime = (id: string) => {
      if (id.includes(":")) {
        const [min, sec] = id.split(":").map(Number);
        return min * 60 + sec;
      }
      return parseFloat(id);
    };

    const timeline: any[] = [];
    const currentState: Record<string, PositionData> = {};
    let mTime = 0;
    let lastTime = 0; // 前のフレームの時間を保持

    // ✨ 修正：Shape関数がある場合の座標計算ロジックを追加
    parsedData.frames.forEach((frame) => {
      const t = parseTime(frame.id);
      mTime = Math.max(mTime, t);

      if (frame.shape) {
        // ✨ ライブラリから関数を呼び出して座標を計算！
        const calculatedPositions = ShapeLibrary[frame.shape.type](
          parsedData.members,
          frame.shape.params,
          frame.shape.origin,
        );
        calculatedPositions.forEach((p: PositionData) => {
          currentState[p.name] = { ...p };
        });
      } else if (frame.positions) {
        // 従来の手書き指定
        frame.positions.forEach((p) => {
          currentState[p.name] = { ...p };
        });
      }

      const interval = t - lastTime;
      const moveDuration =
        frame.transition !== undefined ? frame.transition : interval;

      timeline.push({
        endTime: t,
        startTime: t - moveDuration,
        duration: moveDuration,
        positions: JSON.parse(JSON.stringify(currentState)),
        sectionName: frame.sectionName,
      });

      lastTime = t;
    });

    setRichTimeline(timeline);
    setMaxTime(mTime);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [parsedData]);

  // アニメーションループ（requestAnimationFrame）
  useEffect(() => {
    let animationFrameId: number;
    let lastTimestamp = performance.now();

    const animate = (now: number) => {
      if (isPlaying) {
        const delta = (now - lastTimestamp) / 1000;
        setCurrentTime((prev) => {
          const nextTime = prev + delta;
          if (nextTime >= maxTime) {
            setIsPlaying(false);
            return maxTime;
          }
          return nextTime;
        });
      }
      lastTimestamp = now;
      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, maxTime]);

  // 座標計算（補間）
  const getCurrentPositions = () => {
    if (richTimeline.length === 0 || !parsedData) return [];

    const easeInOut = (t: number) => {
      t = Math.max(0, Math.min(1, t));
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    };

    const result: any[] = [];

    parsedData.members.forEach((member) => {
      const nextIdx = richTimeline.findIndex((f) => f.endTime >= currentTime);

      if (nextIdx === -1) {
        result.push(richTimeline[richTimeline.length - 1].positions[member]);
        return;
      }
      if (nextIdx === 0) {
        result.push(richTimeline[0].positions[member]);
        return;
      }

      const nextF = richTimeline[nextIdx];
      const prevF = richTimeline[nextIdx - 1];
      const targetPos = nextF.positions[member];
      const prevPos = prevF.positions[member];

      if (!targetPos || !prevPos) return;

      if (currentTime <= nextF.startTime) {
        result.push(prevPos);
      } else {
        const progress = (currentTime - nextF.startTime) / nextF.duration;
        const eased = easeInOut(progress);

        result.push({
          name: member,
          position: {
            x:
              prevPos.position.x +
              (targetPos.position.x - prevPos.position.x) * eased,
            y:
              prevPos.position.y +
              (targetPos.position.y - prevPos.position.y) * eased,
          },
        });
      }
    });

    return result;
  };

  const currentPositions = getCurrentPositions();

  // シークバーの操作性向上：ドラッグ中も値を即座に反映
  const handleSeek = (e: React.FormEvent<HTMLInputElement>) => {
    const val = parseFloat(e.currentTarget.value);
    setIsPlaying(false); // つかんでいる間は再生を止める
    setCurrentTime(val);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const currentFrameObj = [...richTimeline]
    .reverse()
    .find((f) => f.endTime <= currentTime);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#222",
        color: "white",
      }}
    >
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
            marginBottom: "20px",
          }}
        />

        {parsedData && (
          <div
            style={{
              padding: "15px",
              backgroundColor: "#2d3748",
              borderRadius: "5px",
              fontSize: "14px",
            }}
          >
            <strong>Group:</strong> {parsedData.groupName}
            <br />
            <strong>Music:</strong> {parsedData.music || "None"}
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              color: "#ff6b6b",
              marginTop: "20px",
              whiteSpace: "pre-wrap",
              backgroundColor: "#3a1c1c",
              padding: "10px",
              fontSize: "12px",
            }}
          >
            {errorMsg}
          </div>
        )}

        {parsedData && richTimeline.length > 0 && (
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
                marginBottom: "15px",
              }}
            >
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                style={{
                  padding: "10px 20px",
                  fontSize: "14px",
                  fontWeight: "bold",
                  backgroundColor: isPlaying ? "#ff4757" : "#2ed573",
                  border: "none",
                  borderRadius: "5px",
                  color: "white",
                  cursor: "pointer",
                  width: "100px",
                }}
              >
                {isPlaying ? "PAUSE" : "PLAY"}
              </button>
              <div style={{ fontSize: "20px", fontFamily: "monospace" }}>
                {formatTime(currentTime)}
              </div>
            </div>

            <input
              type="range"
              min="0"
              max={maxTime}
              step="0.001" // ✨ 1ミリ秒単位で細かく制御
              value={currentTime}
              onInput={handleSeek}
              style={{ width: "100%", cursor: "grab" }}
            />

            <div
              style={{
                textAlign: "center",
                marginTop: "10px",
                color: "#00d2ff",
                fontWeight: "bold",
              }}
            >
              {currentFrameObj?.sectionName
                ? `[${currentFrameObj.sectionName}]`
                : "---"}
            </div>
          </div>
        )}
      </div>

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
            const mIdx = parsedData?.members?.indexOf(member.name) ?? -1;
            const color =
              mIdx !== -1 && parsedData?.colors?.[mIdx]
                ? parsedData.colors[mIdx]
                : "#8e44ad";

            return (
              <g
                key={member.name}
                transform={`translate(${CENTER_X + member.position.x * SCALE}, ${CENTER_Y - member.position.y * SCALE})`}
              >
                <circle r="15" fill={color} stroke="#fff" strokeWidth="2" />
                <text
                  y="-22"
                  fill="white"
                  textAnchor="middle"
                  fontSize="12"
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
