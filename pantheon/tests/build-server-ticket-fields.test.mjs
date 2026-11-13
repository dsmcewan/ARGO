import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredTicketFieldRefusal, REQUIRED_TICKET_FIELDS } from "../src/view/build-server.mjs";

// WHAT THIS PINS. On 2026-09-28 a ticket drafted by gpt-5.5 was accepted at the door, ran a full
// intake scout -- 58 seconds, 81,280 tokens, twelve tool calls against the target repo -- and then
// died publishing its evidence:
//
//     scout agy_google publish: search.query must be a non-empty string
//
// The scout publishes `{ kind: "search", payload: { query: spec.question } }` (run-item.mjs), so a
// ticket with no `question` cannot possibly survive intake. The door validated `key`, `repo_root`
// and containment, and let that one through. Nothing was wrong with the scout, the seat, or the
// schema: the gate simply did not check a field the pipeline hard-requires one stage later.
//
// A gate that admits work it knows will fail is not a gate. The cost is paid in the vendor's
// tokens and the operator's minutes, and the error surfaces far from its cause.

test("a ticket missing a field the pipeline requires is refused AT THE DOOR", () => {
  const good = { key: "k", repo_root: "/r", question: "what breaks?", title: "t", goal: "g", copy:[], acceptance_cmd:"true", slot:"out" };
  assert.equal(requiredTicketFieldRefusal(good), null);

  for (const field of REQUIRED_TICKET_FIELDS) {
    const missing = { ...good };
    delete missing[field];
    const why = requiredTicketFieldRefusal(missing);
    assert.ok(why, `a ticket with no \`${field}\` must be refused before anything is spent`);
    assert.match(why, new RegExp(`ticket\\.${field}`),
      "the refusal must name the field, so the drafter can be fixed rather than guessed at");
  }
});

test("empty and whitespace are missing, because that is what actually arrived", () => {
  // The failing ticket did not omit the key -- LEXI's own _REQUIRED_KEYS check passes on a key
  // that is PRESENT. What arrived was empty, which is why presence was never enough.
  const base = { key: "k", repo_root: "/r", question: "q", title: "t", goal: "g", copy:[], acceptance_cmd:"true", slot:"out" };
  for (const bad of ["", "   ", "\n", null, 7, [], {}]) {
    const why = requiredTicketFieldRefusal({ ...base, question: bad });
    assert.ok(why, `question=${JSON.stringify(bad)} must be refused`);
    assert.match(why, /ticket\.question/);
  }
});

test("`question` is required, because the intake scout publishes it as search.query", () => {
  // Named explicitly rather than left to the list: this is the field whose absence cost the run.
  assert.ok(REQUIRED_TICKET_FIELDS.includes("question"),
    "run-item.mjs publishes { kind: 'search', payload: { query: spec.question } }, and schema.mjs " +
    "refuses an empty query -- so a ticket without it is a build that cannot finish");
});

test("the refusal names every missing field at once, not just the first", () => {
  // Handing back one field at a time turns fixing a drafter into a guessing game with a
  // 58-second round trip per guess.
  const why = requiredTicketFieldRefusal({ key: "k", repo_root: "/r" });
  for (const field of ["question", "title", "goal"]) assert.match(why, new RegExp(field));
});

test("the fields the door checks are ones the pipeline actually dereferences", () => {
  // The guard against this list drifting into a wish: every name here must be something
  // run-item.mjs really reads off the spec, or the door starts refusing valid tickets.
  const used = new Set(["key", "title", "question", "goal", "repo_root", "slots", "slot",
    "copy", "constraints", "forbidden", "attach", "tests_file"]);
  for (const f of REQUIRED_TICKET_FIELDS) {
    assert.ok(used.has(f), `${f} is not a field run-item.mjs reads; requiring it would refuse ` +
      `tickets that would have built fine`);
  }
});

test('runtime copy, acceptance command and slot plan are required before admission',()=>{
 const base={key:'k',repo_root:'/r',question:'q',title:'t',goal:'g',copy:[],acceptance_cmd:'true',slot:'out'};
 for(const field of ['copy','acceptance_cmd','slot']){
  const bad={...base};delete bad[field];assert.match(requiredTicketFieldRefusal(bad),new RegExp(field));
 }
 assert.match(requiredTicketFieldRefusal({...base,slots:[{slot:'a'},{slot:'a'}],slot:undefined}),/duplicate/);
 assert.match(requiredTicketFieldRefusal({...base,copy:null}),/copy/);
 assert.equal(requiredTicketFieldRefusal({...base,slot:undefined,slots:[{slot:'a',path:'a.mjs'}]}),null);
});
