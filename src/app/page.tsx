// src/app/page.tsx
"use client"; // ← Reactの機能（useState等）をブラウザで動かすためのNext.jsのルール

import { useState, useEffect } from "react";
import * as ohm from "ohm-js";
// 1. Ohm.jsの文法定義（外に出しておく）
const grammar = ohm.grammar(`
  DiaPlus {
    Formation = Placement*
    Placement = memberName ":" Coordinate
    Coordinate = number "," number
    memberName = lower+
    number = "-"? digit+ ("." digit+)?
  }
`);

const semantics = grammar.createSemantics();
semantics.addOperation("toJSON", {
  Formation(placements: any) {
    return placements.children.map((p: any) => p.toJSON());
  },
  Placement(name: any, _colon: any, coord: any) {
    return { name: name.sourceString, position: coord.toJSON() };
  },
  Coordinate(x: any, _comma: any, y: any) {
    return { x: parseFloat(x.sourceString), y: parseFloat(y.sourceString) };
  },
});

// 2. メインの画面コンポーネント
export default function Home() {
  const SCALE = 50;

  // ReactのState（状態管理）
  // inputText: 左側のテキストエリアに入力された文字
  const [inputText, setInputText] = useState("manatsu : 0, 1\nnene : -1.5, 2");
  // formationData: 解析成功後のJSONデータ
  const [formationData, setFormationData] = useState<any[]>([]);
  // errorMsg: 文法エラーがあった場合のエラー文
  const [errorMsg, setErrorMsg] = useState("");

  // 文字が入力される（inputTextが変わる）たびに、自動で解析を実行する
  useEffect(() => {
    const matchResult = grammar.match(inputText);
    if (matchResult.succeeded()) {
      // 成功：エラーを消して、JSONデータを更新
      setErrorMsg("");
      setFormationData(semantics(matchResult).toJSON());
    } else {
      // 失敗：エラーメッセージを表示（データは更新しない）
      setErrorMsg((matchResult as any).message);
    }
  }, [inputText]);

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#222",
        color: "white",
      }}
    >
      {/* 左半分：エディタ部分 */}
      <div
        style={{
          flex: 1,
          padding: "20px",
          borderRight: "1px solid #444",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <h2>Dia+ Editor</h2>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          style={{
            flex: 1,
            backgroundColor: "#111",
            color: "#fff",
            padding: "10px",
            fontSize: "16px",
            fontFamily: "monospace",
          }}
        />
        {/* エラーがある時だけ赤文字で表示 */}
        {errorMsg && (
          <div
            style={{
              color: "#ff6b6b",
              marginTop: "10px",
              whiteSpace: "pre-wrap",
            }}
          >
            {errorMsg}
          </div>
        )}
      </div>

      {/* 右半分：プレビュー（SVG）部分 */}
      <div
        style={{
          flex: 1,
          padding: "20px",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <svg
          width="600"
          height="600"
          style={{ backgroundColor: "#111", border: "1px solid #555" }}
        >
          <line
            x1="300"
            y1="0"
            x2="300"
            y2="600"
            stroke="gray"
            strokeDasharray="5,5"
          />

          {formationData.map((member) => {
            const screenX = 300 + member.position.x * SCALE;
            const screenY = 400 - member.position.y * SCALE;

            return (
              <g
                key={member.name}
                transform={`translate(${screenX}, ${screenY})`}
              >
                <circle r="15" fill="purple" />
                <text y="-25" fill="white" textAnchor="middle" fontSize="14">
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
