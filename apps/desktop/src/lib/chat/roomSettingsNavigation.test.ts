import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./RoomWorkspace.svelte", import.meta.url), "utf8").split("</script>")[0].replace('<script lang="ts">', "");
const ast = ts.createSourceFile("room.ts", source, ts.ScriptTarget.Latest, true);
const navigation = ast.statements.filter(node => ts.isLabeledStatement(node) && (/endpoint === catalogEndpoint|if \(editRequested && view/.test(node.getText(ast)))).map(node => node.getText(ast)).join("\n");
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["open", "setup"].includes(node.name?.text ?? "")).map(node => node.getText(ast)).join("\n");
const script = ts.transpileModule(`${functions}\n${navigation}`, {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.None}}).outputText;

function fixture() {
  const room = {id:"room-a",title:"Room A",participants:[{agentId:"default",active:true}],primaryAgentId:"default"};
  const state: Record<string, any> = {
    endpoint:"fixture",catalogEndpoint:"fixture",navigationRevision:2,appliedNavigationRevision:1,
    requestedRoomId:"room-a",applied:"room-a",editRequested:true,editing:false,view:{room},
    activeDraftKey:"",input:"",files:[],thinking:undefined,defaultThinking:"medium",modelKey:"",
    showHome:true,historyExpanded:false,selectedSession:"session-a",selected:"room-a",generation:0,
    executionActivities:{},error:"",targets:[],replyToId:"",pendingSend:undefined,cursor:0,
    title:"",members:[],primary:"",projectId:"",permission:"",
    closeStream:()=>state.generation++,clearMedia:()=>{},onSelectRoom:()=>{},watch:()=>{},
    onEditConsumed:()=>state.editRequested=false,
    loadDesktopRoom:async()=>({room,session:{id:"session-a"}}),
  };
  return state;
}

test("editing an already loaded room survives the parent's navigation revision", async () => {
  const state=fixture();
  new Function("state", `with(state) { ${script} }`)(state);
  await Promise.resolve();
  assert.equal(state.editing,true);
  assert.equal(state.title,"Room A");
  assert.equal(state.editRequested,false);
});
