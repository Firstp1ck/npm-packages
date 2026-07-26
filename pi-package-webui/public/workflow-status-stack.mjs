const WORKFLOW_STATUS_TOOL_NAME = "workflow_status";

export function isCompletedWorkflowStatusExecution(message) {
  if (message?.role !== "toolExecution") return false;
  const name = String(message.toolName || message.name || "");
  return name === WORKFLOW_STATUS_TOOL_NAME && !message.live && !message.isPartial && message.result !== undefined && message.result !== null;
}

function workflowStatusStackKey(items) {
  const first = items[0] || {};
  const toolCallId = String(first.message?.toolCallId ?? "").trim();
  const id = toolCallId || (first.messageIndex !== undefined ? `m:${first.messageIndex}` : first.order !== undefined ? `o:${first.order}` : "first");
  return `workflow-status-stack:${id}`;
}

export function groupConsecutiveWorkflowStatusItems(items) {
  const grouped = [];
  let pending = [];

  const flush = () => {
    if (pending.length === 1) {
      grouped.push(pending[0]);
    } else if (pending.length > 1) {
      const first = pending[0];
      const latest = pending.at(-1);
      const updates = pending.map((item) => item.message);
      grouped.push({
        ...first,
        message: {
          role: "workflowStatusStack",
          title: `workflow_status · ${updates.length} updates`,
          timestamp: latest.message?.timestamp || first.message?.timestamp,
          content: latest.message?.result?.content,
          workflowStatusUpdates: updates,
          isError: updates.some((update) => update?.isError || update?.result?.isError),
        },
        transcriptKey: workflowStatusStackKey(pending),
      });
    }
    pending = [];
  };

  for (const item of items || []) {
    if (isCompletedWorkflowStatusExecution(item?.message)) pending.push(item);
    else {
      flush();
      grouped.push(item);
    }
  }
  flush();
  return grouped;
}

export function workflowStatusSnapshot(text) {
  const fields = {};
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const match = /^(Workflow|Run|Status|Tasks):\s*(.+)$/i.exec(line);
    if (match) fields[match[1].toLowerCase()] = match[2].trim();
  }
  const fallback = lines[0] || "No workflow status details were returned.";
  return {
    workflow: fields.workflow || "",
    run: fields.run || "",
    status: fields.status || "",
    tasks: fields.tasks || "",
    fallback: fallback.length > 180 ? `${fallback.slice(0, 179)}…` : fallback,
  };
}
