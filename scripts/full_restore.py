import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

# 1. Restore the Trigger Node (it was accidentally deleted)
trigger_node = {
  "parameters": {},
  "type": "n8n-nodes-base.manualTrigger",
  "typeVersion": 1,
  "position": [-4336, -592],
  "id": "aa1d0ac8-393b-4a08-b728-33a96b795720",
  "name": "When clicking \"Execute workflow\""
}

# Ensure it's not already in nodes (by type)
if not any(n["type"] == "n8n-nodes-base.manualTrigger" for n in data["nodes"]):
    data["nodes"].insert(0, trigger_node)

# 2. Get the clean names of all nodes for connection building
nodes_by_type = {}
for node in data["nodes"]:
    nodes_by_type[node["type"]] = node

setup_node = next((n for n in data["nodes"] if n["name"] == "Execute Command1"), None)
thumbs_node = next((n for n in data["nodes"] if n["name"] == "Extract Thumbnails"), None)
sheets_node = next((n for n in data["nodes"] if n["name"] == "Get row(s) in sheet"), None)
classify_node = next((n for n in data["nodes"] if n["name"] == "Execute Command3"), None)
cleanup_node = next((n for n in data["nodes"] if n["name"] == "Execute Command6"), None)
merge_node = next((n for n in data["nodes"] if n["name"] == "Merge"), None)

# Update Merge state
if merge_node:
    merge_node["parameters"] = {
        "mode": "choose",
        "choice": "wait"
    }
    merge_node["typeVersion"] = 3.2

# 3. Re-build connections from scratch with clean names
new_conns = {}

# Trigger -> Setup
new_conns[trigger_node["name"]] = {"main": [[{"node": setup_node["name"], "type": "main", "index": 0}]]}

# Setup -> Thumbs + Merge (Index 0)
new_conns[setup_node["name"]] = {"main": [[
    {"node": thumbs_node["name"], "type": "main", "index": 0},
    {"node": merge_node["name"], "type": "main", "index": 0}
]]}

# Thumbs -> Sheets
new_conns[thumbs_node["name"]] = {"main": [[{"node": sheets_node["name"], "type": "main", "index": 0}]]}

# Sheets -> Classify
new_conns[sheets_node["name"]] = {"main": [[{"node": classify_node["name"], "type": "main", "index": 0}]]}

# Classify -> Merge (Index 1)
new_conns[classify_node["name"]] = {"main": [[{"node": merge_node["name"], "type": "main", "index": 1}]]}

# Merge -> Cleanup
new_conns[merge_node["name"]] = {"main": [[{"node": cleanup_node["name"], "type": "main", "index": 0}]]}

data["connections"] = new_conns

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Workflow FULLY restored and repaired.")
