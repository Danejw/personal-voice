import { describe, expect, it } from "vitest";
import { requiresExplicitToolApproval } from "@/assistant/approvalPolicy";

describe("desktop assistant approval policy", () => {
  it("reviews all UIA actions until routine automation is enabled", () => {
    expect(requiresExplicitToolApproval("accessibility_pattern_action",JSON.stringify({action:"focus"}),false)).toBe(true);
    expect(requiresExplicitToolApproval("uia_control_action",JSON.stringify({action:"scroll-down"}),false)).toBe(true);
  });
  it("auto-approves only reversible accessibility navigation when opted in", () => {
    for(const action of ["highlight","focus","scroll-up","scroll-down","scroll-left","scroll-right",
      "expand","collapse","scroll-into-view","realize","move","resize","maximize","restore"]) {
      expect(requiresExplicitToolApproval("accessibility_pattern_action",JSON.stringify({action}),true)).toBe(false);
    }
    for(const action of ["invoke","toggle","select","set-range","set-value"]) {
      expect(requiresExplicitToolApproval("accessibility_pattern_action",JSON.stringify({action}),true)).toBe(true);
    }
  });
  it("always reviews photography, monitoring and legacy invoke actions", () => {
    for(const name of ["paste_camera_photo","start_accessibility_watch","invoke_accessible_control"]) {
      expect(requiresExplicitToolApproval(name,"",true)).toBe(true);
    }
    expect(requiresExplicitToolApproval("uia_control_action",JSON.stringify({action:"invoke"}),true)).toBe(true);
    expect(requiresExplicitToolApproval("uia_control_action","{bad-json",true)).toBe(true);
    expect(requiresExplicitToolApproval("accessibility_pattern_action","{bad-json",true)).toBe(true);
  });
  it("does not add approvals to existing notes tools", () => {
    expect(requiresExplicitToolApproval("create_voice_note","",false)).toBe(false);
  });
});
