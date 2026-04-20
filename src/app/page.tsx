"use client";
import { useState, useEffect } from "react";
import * as ohm from "ohm-js";

// --- 型定義 ---
interface PositionData {
  name: string;
  position: { x: number; y: number };
}
interface ShapeData {
  type: string;
  params: Record<string, any>;
  origin: { x: number; y: number };
}
interface FrameData {
  type: "frame";
  id: string;
  transition?: number;
  positions?: PositionData[];
  shapes?: ShapeData[];
  sectionName?: string;
  songName?: string;
}
interface DiaPlusData {
  mode: "time" | "measure";
  bpm?: number;
  offset?: number;
  youtube?: string;
  groupName: string;
  songName?: string;
  members: string[];
  colors: string[];
  frames: FrameData[];
}

const ShapeLibrary: Record<string, Function> = {
  line: (members: string[], params: any, origin: { x: number; y: number }) => {
    const spacing = params.spacing !== undefined ? params.spacing : 2;
    const order: number[] = params.order || members.map((_, i) => i + 1);
    let angleDeg = 0;
    if (params.angle !== undefined) {
      if (params.angle === "vertical") angleDeg = 90;
      else if (params.angle === "horizontal") angleDeg = 0;
      else if (typeof params.angle === "number") angleDeg = params.angle;
    }
    const rad = angleDeg * (Math.PI / 180);
    const result: PositionData[] = [];
    const count = order.length;
    order.forEach((memberIndex, i) => {
      const name = members[memberIndex - 1];
      if (!name) return;
      const distance = (i - (count - 1) / 2) * spacing;
      const offsetX = distance * Math.cos(rad);
      const offsetY = -distance * Math.sin(rad);
      result.push({
        name,
        position: { x: origin.x + offsetX, y: origin.y + offsetY },
      });
    });
    return result;
  },
};

// --- 文法定義 ---
const grammar = ohm.grammar(`
  Diaplus {
    Program = Mode Bpm? Offset? Youtube? Stage
    space += comment
    comment = "//" (~"\\n" any)*
    
    Mode = "mode" ("time" | "measure")
    Bpm = "bpm" number 
    Offset = "offset" number
    Youtube = "youtube" "(" String ")"
    
    Stage = "stage" "(" ListOf<StageArg, ","> ")" "{" StageBody* "}"
    StageArg = identifier "=" String
    StageBody = Members | Colors | Element
    Members = "members" ":" StringArray
    Colors = "colors" ":" StringArray
    StringArray = "[" ListOf<String, ","> "]"
    Element = Section | Frame
    Section = "section" String "{" Frame* "}"
    Frame = "frame" "@" FrameId "{" Transition? (ShapeCall+ | Formation) "}"
    ShapeCall = ShapeName "(" ListOf<ShapeParam, ","> ")" ":" Coordinate
    ShapeName = "line"
    ShapeParam = identifier "=" (NumArray | NumberVal | String)
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
  Program(mode, optBpm, optOffset, optYoutube, stageBlock) {
    const bpmNode = optBpm.children[0];
    const offsetNode = optOffset.children[0];
    return {
      mode: mode.toJSON(),
      bpm: bpmNode ? bpmNode.toJSON() : undefined,
      offset: offsetNode ? offsetNode.toJSON() : undefined,
      youtube: optYoutube.children[0]?.toJSON(),
      ...stageBlock.toJSON(),
    };
  },
  Bpm(_bpm, num) {
    return parseFloat(num.sourceString);
  },
  Offset(_offset, num) {
    return parseFloat(num.sourceString);
  },
  Youtube(_yt, _lparen, path, _rparen) {
    return path.toJSON();
  },
  StageArg(id, _eq, str) {
    return { key: id.sourceString, val: str.toJSON() };
  },
  Stage(_stage, _lparen, args, _rparen, _lbrace, body, _rbrace) {
    const argList = args.asIteration().children.map((a) => a.toJSON());
    const argObj = Object.fromEntries(argList.map((a) => [a.key, a.val]));
    const groupName = argObj.group || "Unknown Group";
    const songName = argObj.song || "Unknown Song";
    const frames: any[] = [];
    let members: string[] = [];
    let colors: string[] = [];
    body.children.forEach((b: any) => {
      const parsed = b.toJSON();
      if (parsed.type === "members") members = parsed.data;
      else if (parsed.type === "colors") colors = parsed.data;
      else if (parsed.type === "section")
        parsed.frames.forEach((f: any) =>
          frames.push({ ...f, sectionName: parsed.name, songName }),
        );
      else if (parsed.type === "frame") frames.push({ ...parsed, songName });
    });
    return { groupName, songName, members, colors, frames };
  },
  Members(_m, _c, arr) {
    return { type: "members", data: arr.toJSON() };
  },
  Colors(_c, _col, arr) {
    return { type: "colors", data: arr.toJSON() };
  },
  StringArray(_l, list, _r) {
    return list.asIteration().children.map((c: any) => c.toJSON());
  },
  ShapeCall(name, _lparen, params, _rparen, _colon, coord) {
    const pList = params.asIteration().children.map((p) => p.toJSON());
    return {
      type: name.sourceString,
      params: Object.fromEntries(pList.map((p) => [p.key, p.val])),
      origin: coord.toJSON(),
    };
  },
  ShapeParam(id, _eq, val) {
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
    let shapes, positions;
    if (Array.isArray(parsed) && parsed.length > 0) {
      if (parsed[0].type) shapes = parsed;
      else if (parsed[0].name) positions = parsed;
    }
    return {
      type: "frame",
      id: id.sourceString,
      transition: trans,
      positions,
      shapes,
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

export default function Home() {
  const REAL_WIDTH = 15;
  const REAL_HEIGHT = 8;
  const DOT_RADIUS = 0.25;
  const SCALE = 50;
  const STAGE_WIDTH = REAL_WIDTH * SCALE + 100;
  const STAGE_HEIGHT = REAL_HEIGHT * SCALE + 100;
  const CENTER_X = STAGE_WIDTH / 2;
  const CENTER_Y = STAGE_HEIGHT / 2;

  const [fileName, setFileName] = useState("ファイルが選択されていません");
  const [fileContent, setFileContent] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [semanticErrors, setSemanticErrors] = useState<string[]>([]);
  const [parsedData, setParsedData] = useState<DiaPlusData | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [maxTime, setMaxTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [richTimeline, setRichTimeline] = useState<any[]>([]);

  const [youtubePlayer, setYoutubePlayer] = useState<any>(null);
  const [videoId, setVideoId] = useState<string>("");

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
      setSemanticErrors([]);
      try {
        const data = semantics(matchResult).toJSON() as DiaPlusData;

        // ✨ 追加：measureモードなのにBPMがない場合はエラーを吐く！
        if (data.mode === "measure" && data.bpm === undefined) {
          throw new Error(
            "mode が 'measure' の場合、BPMの指定（例: bpm 120）は必須です。",
          );
        }

        setParsedData(data);
        if (data.youtube)
          setVideoId(
            data.youtube
              .replace(/^"|"$/g, "")
              .match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1] || "",
          );
        else setVideoId("");
      } catch (err: any) {
        setErrorMsg("変換エラー: " + err.message);
        setParsedData(null); // エラー時はデータをクリアしてシミュレーターを止める
      }
    } else {
      setErrorMsg((matchResult as any).message);
      setSemanticErrors([]);
      setParsedData(null);
    }
  }, [fileContent]);

  const checkCollision = (
    start1: any,
    end1: any,
    start2: any,
    end2: any,
    threshold = 0.6,
  ) => {
    const v1x = end1.x - start1.x;
    const v1y = end1.y - start1.y;
    const v2x = end2.x - start2.x;
    const v2y = end2.y - start2.y;
    const dpx = start1.x - start2.x;
    const dpy = start1.y - start2.y;
    const dvx = v1x - v2x;
    const dvy = v1y - v2y;
    const a = dvx * dvx + dvy * dvy;
    const c = dpx * dpx + dpy * dpy;
    if (a === 0) return Math.sqrt(c) < threshold;
    const b = 2 * (dpx * dvx + dpy * dvy);
    let t = -b / (2 * a);
    t = Math.max(0, Math.min(1, t));
    return a * t * t + b * t + c < threshold * threshold;
  };

  const getPosAtT = (move: any, t: number) => {
    const easeInOut = (val: number) =>
      val < 0.5 ? 2 * val * val : 1 - Math.pow(-2 * val + 2, 2) / 2;
    const eased = easeInOut(t);
    if (move.control) {
      const x =
        Math.pow(1 - eased, 2) * move.start.x +
        2 * (1 - eased) * eased * move.control.x +
        Math.pow(eased, 2) * move.end.x;
      const y =
        Math.pow(1 - eased, 2) * move.start.y +
        2 * (1 - eased) * eased * move.control.y +
        Math.pow(eased, 2) * move.end.y;
      return { x, y };
    } else {
      return {
        x: move.start.x + (move.end.x - move.start.x) * eased,
        y: move.start.y + (move.end.y - move.start.y) * eased,
      };
    }
  };

  const formatTimeStr = (seconds: number) => {
    if (parsedData?.mode === "measure") {
      const bpm = parsedData.bpm || 120;
      const totalBeats = seconds / (60 / bpm);
      const m = Math.floor(totalBeats / 4) + 1;
      const b = (totalBeats % 4) + 1;
      return `M${m}:B${b.toFixed(1).replace(".0", "")}`;
    }
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    if (!parsedData || parsedData.frames.length === 0) return;
    const bpm = parsedData.bpm || 120;

    const parseTime = (id: string) => {
      if (parsedData.mode === "measure") {
        let m = 1,
          b = 1;
        if (id.includes(":")) {
          [m, b] = id.split(":").map(Number);
        } else {
          m = parseFloat(id);
        }
        const totalBeats = (m - 1) * 4 + (b - 1);
        return totalBeats * (60 / bpm);
      } else {
        if (id.includes(":")) {
          const [min, sec] = id.split(":").map(Number);
          return min * 60 + sec;
        }
        return parseFloat(id);
      }
    };

    const sortedFrames = [...parsedData.frames].sort(
      (a, b) => parseTime(a.id) - parseTime(b.id),
    );

    const initialPositions: Record<string, { x: number; y: number }> = {};
    sortedFrames.forEach((frame) => {
      if (frame.shapes) {
        frame.shapes.forEach((shapeData: any) => {
          const calculated = ShapeLibrary[shapeData.type](
            parsedData.members,
            shapeData.params,
            shapeData.origin,
          );
          calculated.forEach((p: PositionData) => {
            if (!initialPositions[p.name])
              initialPositions[p.name] = { ...p.position };
          });
        });
      } else if (frame.positions) {
        frame.positions.forEach((p: any) => {
          if (!initialPositions[p.name])
            initialPositions[p.name] = { ...p.position };
        });
      }
    });

    const timeline: any[] = [];
    const currentState: Record<string, PositionData> = {};
    let mTime = 0;
    let lastTime = 0;
    const newSemanticErrors: string[] = [];

    const isBackstage = (p: { x: number; y: number }) =>
      p.x < -8 || p.x > 8 || p.y < -5 || p.y > 5;

    parsedData.members.forEach((m) => {
      currentState[m] = {
        name: m,
        position: initialPositions[m] || { x: 0, y: 0 },
      };
    });

    sortedFrames.forEach((frame) => {
      const t = parseTime(frame.id);
      mTime = Math.max(mTime, t);

      const targetPositions: Record<string, PositionData> = {};
      if (frame.shapes) {
        frame.shapes.forEach((shapeData: any) => {
          const calculatedPositions = ShapeLibrary[shapeData.type](
            parsedData.members,
            shapeData.params,
            shapeData.origin,
          );
          calculatedPositions.forEach((p: PositionData) => {
            targetPositions[p.name] = { ...p };
          });
        });
      } else if (frame.positions) {
        frame.positions.forEach((p: any) => {
          targetPositions[p.name] = { ...p };
        });
      }
      parsedData.members.forEach((m) => {
        if (!targetPositions[m] && currentState[m])
          targetPositions[m] = { ...currentState[m] };
      });

      const movements: Record<string, any> = {};
      parsedData.members.forEach((m) => {
        const start = currentState[m]?.position || { x: 0, y: 0 };
        const end = targetPositions[m]?.position || start;
        movements[m] = { start, end };
      });

      let moveDuration = t - lastTime;
      if (frame.transition !== undefined) {
        if (parsedData.mode === "measure") {
          moveDuration = frame.transition * (60 / bpm);
        } else {
          moveDuration = frame.transition;
        }
      }

      const members = parsedData.members;

      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const p1 = targetPositions[members[i]]?.position;
          const p2 = targetPositions[members[j]]?.position;
          if (p1 && p2) {
            if (isBackstage(p1) || isBackstage(p2)) continue;
            const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
            if (dist < 0.48) {
              newSemanticErrors.push(
                `[${formatTimeStr(t)}] 配置被り: ${members[i]} と ${members[j]} の最終位置が同じ場所です。`,
              );
            }
          }
        }
      }

      members.forEach((m) => {
        const move = movements[m];
        if (moveDuration === 0) return;
        if (isBackstage(move.start) || isBackstage(move.end)) return;
        const dist = Math.hypot(
          move.end.x - move.start.x,
          move.end.y - move.start.y,
        );
        const speed = dist / moveDuration;
        if (speed > 3) {
          newSemanticErrors.push(
            `[${formatTimeStr(t)}] 速度超過: ${m} の速度が限界(3.0m/s)を超えています（${speed.toFixed(1)}m/s）。`,
          );
        }
      });

      const BASE_EVADE = 0.6;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const m1 = members[i];
          const m2 = members[j];
          const move1 = movements[m1];
          const move2 = movements[m2];

          if (moveDuration === 0) continue;
          if (
            isBackstage(move1.start) ||
            isBackstage(move1.end) ||
            isBackstage(move2.start) ||
            isBackstage(move2.end)
          )
            continue;

          const isM1Moving =
            move1.start.x !== move1.end.x || move1.start.y !== move1.end.y;
          const isM2Moving =
            move2.start.x !== move2.end.x || move2.start.y !== move2.end.y;

          if (!isM1Moving && !isM2Moving) continue;

          if (
            checkCollision(move1.start, move1.end, move2.start, move2.end, 0.6)
          ) {
            let evade1 = BASE_EVADE;
            let evade2 = BASE_EVADE;
            if (!isM1Moving) evade2 *= 2;
            if (!isM2Moving) evade1 *= 2;
            const len1 =
              Math.hypot(
                move1.end.x - move1.start.x,
                move1.end.y - move1.start.y,
              ) || 1;
            const n1 = {
              x: -(move1.end.y - move1.start.y) / len1,
              y: (move1.end.x - move1.start.x) / len1,
            };
            const len2 =
              Math.hypot(
                move2.end.x - move2.start.x,
                move2.end.y - move2.start.y,
              ) || 1;
            const n2 = {
              x: -(move2.end.y - move2.start.y) / len2,
              y: (move2.end.x - move2.start.x) / len2,
            };
            const mid1 = {
              x: (move1.start.x + move1.end.x) / 2,
              y: (move1.start.y + move1.end.y) / 2,
            };
            const mid2 = {
              x: (move2.start.x + move2.end.x) / 2,
              y: (move2.start.y + move2.end.y) / 2,
            };

            if (!movements[m1].control && isM1Moving)
              movements[m1].control = {
                x: mid1.x + n1.x * evade1,
                y: mid1.y + n1.y * evade1,
              };
            if (!movements[m2].control && isM2Moving)
              movements[m2].control = {
                x: mid2.x + n2.x * evade2,
                y: mid2.y + n2.y * evade2,
              };
          }
        }
      }

      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const m1 = members[i];
          const m2 = members[j];
          const move1 = movements[m1];
          const move2 = movements[m2];

          if (moveDuration === 0) continue;
          if (
            isBackstage(move1.start) ||
            isBackstage(move1.end) ||
            isBackstage(move2.start) ||
            isBackstage(move2.end)
          )
            continue;

          let collided = false;
          for (let sample = 0; sample <= 1; sample += 0.1) {
            const p1 = getPosAtT(move1, sample);
            const p2 = getPosAtT(move2, sample);
            if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 0.48) {
              collided = true;
              break;
            }
          }
          if (collided) {
            newSemanticErrors.push(
              `[${formatTimeStr(t)}] 回避不能: ${m1} と ${m2} が移動中に激突しています（ルートが塞がれています）。`,
            );
          }
        }
      }

      timeline.push({
        endTime: t,
        startTime: t - moveDuration,
        duration: moveDuration,
        movements,
        sectionName: frame.sectionName,
        songName: frame.songName,
      });
      parsedData.members.forEach((m) => {
        if (targetPositions[m]) currentState[m] = { ...targetPositions[m] };
      });
      lastTime = t;
    });

    setSemanticErrors(newSemanticErrors);
    setRichTimeline(timeline);
    setMaxTime(mTime);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [parsedData]);

  useEffect(() => {
    if (!videoId) return;
    let player: any = null;
    const loadVideo = () => {
      const container = document.getElementById("youtube-player-container");
      if (container) container.innerHTML = "";
      player = new (window as any).YT.Player("youtube-player-container", {
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          modestbranding: 1,
          origin:
            typeof window !== "undefined" ? window.location.origin : undefined,
        },
        events: {
          onReady: (event: any) => setYoutubePlayer(event.target),
          onStateChange: (event: any) => {
            const state = (window as any).YT.PlayerState;
            if (event.data === state.PLAYING) setIsPlaying(true);
            else if (event.data === state.PAUSED) setIsPlaying(false);
          },
        },
      });
    };
    if (!(window as any).YT || !(window as any).YT.Player) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
      (window as any).onYouTubeIframeAPIReady = loadVideo;
    } else loadVideo();
    return () => {
      if (player && typeof player.destroy === "function") player.destroy();
    };
  }, [videoId]);

  useEffect(() => {
    if (!youtubePlayer || typeof youtubePlayer.playVideo !== "function") return;
    if (isPlaying) youtubePlayer.playVideo();
    else youtubePlayer.pauseVideo();
  }, [isPlaying, youtubePlayer]);

  useEffect(() => {
    let animationFrameId: number;
    const animate = () => {
      if (
        isPlaying &&
        youtubePlayer &&
        typeof youtubePlayer.getCurrentTime === "function"
      ) {
        const vTime = youtubePlayer.getCurrentTime();
        const offset = parsedData?.offset || 0;
        setCurrentTime(Math.max(0, vTime - offset));
      }
      animationFrameId = requestAnimationFrame(animate);
    };
    if (isPlaying) animationFrameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, youtubePlayer, parsedData?.offset]);

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
        result.push({
          name: member,
          position: richTimeline[richTimeline.length - 1].movements[member].end,
        });
        return;
      }
      if (currentTime <= richTimeline[nextIdx].startTime) {
        result.push({
          name: member,
          position: richTimeline[nextIdx].movements[member].start,
        });
        return;
      }
      const currentMove = richTimeline[nextIdx].movements[member];
      const progress =
        (currentTime - richTimeline[nextIdx].startTime) /
        richTimeline[nextIdx].duration;
      const eased = easeInOut(progress);
      if (currentMove.control) {
        const t = eased;
        const x =
          Math.pow(1 - t, 2) * currentMove.start.x +
          2 * (1 - t) * t * currentMove.control.x +
          Math.pow(t, 2) * currentMove.end.x;
        const y =
          Math.pow(1 - t, 2) * currentMove.start.y +
          2 * (1 - t) * t * currentMove.control.y +
          Math.pow(t, 2) * currentMove.end.y;
        result.push({ name: member, position: { x, y } });
      } else {
        const x =
          currentMove.start.x +
          (currentMove.end.x - currentMove.start.x) * eased;
        const y =
          currentMove.start.y +
          (currentMove.end.y - currentMove.start.y) * eased;
        result.push({ name: member, position: { x, y } });
      }
    });
    return result;
  };

  const handleSeek = (e: React.FormEvent<HTMLInputElement>) => {
    const val = parseFloat(e.currentTarget.value);
    setCurrentTime(val);
    if (youtubePlayer && typeof youtubePlayer.seekTo === "function") {
      const offset = parsedData?.offset || 0;
      youtubePlayer.seekTo(val + offset, true);
    }
  };

  const formatTimeUI = (seconds: number) => {
    if (parsedData?.mode === "measure") {
      const bpm = parsedData.bpm || 120;
      const totalBeats = seconds / (60 / bpm);
      const m = Math.floor(totalBeats / 4) + 1;
      const b = (totalBeats % 4) + 1;
      return `M${m} : B${b.toFixed(1).replace(".0", "")}`;
    }
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const handleCopyOffset = () => {
    if (youtubePlayer && typeof youtubePlayer.getCurrentTime === "function") {
      const currentVideoTime = youtubePlayer.getCurrentTime();
      const codeToCopy = `offset ${currentVideoTime.toFixed(3)}`;
      navigator.clipboard.writeText(codeToCopy).then(() => {
        alert(
          `コピー完了！\nエディタの mode の下に貼り付けてください。\n\n【コピー内容】\n${codeToCopy}`,
        );
      });
    } else {
      alert("YouTubeの再生が始まっていません！");
    }
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
          width: "30%",
          padding: "30px",
          borderRight: "1px solid #444",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
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
              lineHeight: "1.6",
              marginBottom: "20px",
            }}
          >
            <strong>Group:</strong> {parsedData.groupName}
            <br />
            {parsedData.songName && (
              <>
                <strong>Song:</strong> {parsedData.songName}
                <br />
              </>
            )}
            {parsedData.mode === "measure" && (
              <>
                <strong>BPM:</strong> {parsedData.bpm || 120}
                <br />
              </>
            )}
            <strong>Offset:</strong>{" "}
            {parsedData.offset !== undefined
              ? `${parsedData.offset} sec`
              : "0 (未設定)"}
            <br />
          </div>
        )}

        {errorMsg && (
          <div
            style={{
              color: "#ff6b6b",
              marginBottom: "20px",
              whiteSpace: "pre-wrap",
              backgroundColor: "#3a1c1c",
              padding: "10px",
              borderRadius: "5px",
              fontSize: "13px",
            }}
          >
            <strong>🚨 文法エラー</strong>
            <br />
            {errorMsg}
          </div>
        )}

        {semanticErrors.length > 0 && (
          <div
            style={{
              color: "#ff9f43",
              marginBottom: "20px",
              backgroundColor: "#3d2a0e",
              padding: "15px",
              borderRadius: "5px",
              fontSize: "13px",
              border: "1px solid #e1b12c",
            }}
          >
            <strong>⚠️ 監査警告（物理的・論理的エラー）</strong>
            <ul
              style={{
                paddingLeft: "20px",
                marginTop: "10px",
                marginBottom: 0,
              }}
            >
              {semanticErrors.map((err, idx) => (
                <li key={idx} style={{ marginBottom: "8px" }}>
                  {err}
                </li>
              ))}
            </ul>
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
                {formatTimeUI(currentTime)}
              </div>
            </div>

            <input
              type="range"
              min="0"
              max={maxTime || 1}
              step="0.001"
              value={currentTime}
              onInput={handleSeek}
              style={{ width: "100%", cursor: "grab", marginBottom: "15px" }}
            />

            <button
              onClick={handleCopyOffset}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "#0984e3",
                border: "none",
                borderRadius: "5px",
                color: "white",
                fontWeight: "bold",
                cursor: "pointer",
                fontSize: "12px",
              }}
            >
              🎵 今が曲の開始位置！(offsetをコピー)
            </button>

            <div
              style={{
                textAlign: "center",
                marginTop: "10px",
                color: "#00d2ff",
                fontWeight: "bold",
                fontSize: "14px",
              }}
            >
              {currentFrameObj?.songName
                ? `🎵 ${currentFrameObj.songName}`
                : ""}
              {currentFrameObj?.sectionName
                ? ` [${currentFrameObj.sectionName}]`
                : ""}
            </div>
          </div>
        )}
      </div>

      <div style={{ width: "70%", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            flex: 1,
            borderBottom: "1px solid #444",
            backgroundColor: "#000",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          {videoId ? (
            <div
              id="youtube-player-container"
              style={{ width: "100%", height: "100%" }}
            ></div>
          ) : (
            <div style={{ color: "#666" }}>No Video Loaded</div>
          )}
        </div>
        <div
          style={{
            flex: 1,
            padding: "20px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#111",
          }}
        >
          <svg
            width={STAGE_WIDTH}
            height={STAGE_HEIGHT}
            style={{
              border: "1px solid #555",
              borderRadius: "10px",
              backgroundColor: "#1a1a1a",
            }}
          >
            {Array.from({ length: REAL_WIDTH + 1 }).map((_, i) => {
              const x = CENTER_X - (REAL_WIDTH / 2) * SCALE + i * SCALE;
              return (
                <line
                  key={`v-${i}`}
                  x1={x}
                  y1={CENTER_Y - (REAL_HEIGHT / 2) * SCALE}
                  x2={x}
                  y2={CENTER_Y + (REAL_HEIGHT / 2) * SCALE}
                  stroke="#333"
                  strokeWidth={i === REAL_WIDTH / 2 ? 2 : 1}
                />
              );
            })}
            {Array.from({ length: REAL_HEIGHT + 1 }).map((_, i) => {
              const y = CENTER_Y - (REAL_HEIGHT / 2) * SCALE + i * SCALE;
              return (
                <line
                  key={`h-${i}`}
                  x1={CENTER_X - (REAL_WIDTH / 2) * SCALE}
                  y1={y}
                  x2={CENTER_X + (REAL_WIDTH / 2) * SCALE}
                  y2={y}
                  stroke="#333"
                  strokeWidth={i === REAL_HEIGHT / 2 ? 2 : 1}
                />
              );
            })}
            <circle cx={CENTER_X} cy={CENTER_Y} r="4" fill="#ff4757" />
            {getCurrentPositions().map((member: any) => {
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
                  <circle
                    r={DOT_RADIUS * SCALE}
                    fill={color}
                    stroke="#fff"
                    strokeWidth="2"
                  />
                  <text
                    y={-(DOT_RADIUS * SCALE) - 5}
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
    </div>
  );
}
