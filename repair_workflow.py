import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

# 1. Identify nodes by type and name to avoid encoding issues
trigger_node = None
setup_node = None
extract_thumbs_node = None
sheets_node = None
classify_node = None
merge_node = None
cleanup_node = None

for node in data["nodes"]:
    if node["type"] == "n8n-nodes-base.manualTrigger":
        trigger_node = node
    elif node["name"] == "Execute Command1":
        setup_node = node
    elif node["name"] == "Extract Thumbnails":
        extract_thumbs_node = node
    elif node["name"] == "Get row(s) in sheet":
        sheets_node = node
    elif node["name"] == "Execute Command3":
        classify_node = node
    elif node["name"] == "Merge":
        merge_node = node
        # Fix Merge node to be very simple and robust
        # mode: 'choose', choice: 'wait' is the correct way to "Wait for all" in v3
        merge_node["parameters"] = {
            "mode": "choose",
            "choice": "wait"
        }
        merge_node["typeVersion"] = 3.2
    elif node["name"] == "Execute Command6":
        cleanup_node = node
        cleanup_node["executeOnce"] = True

# 2. Re-build connections from scratch to ensure they are correct
# Structure: Trigger -> Setup -> Thumbs -> Sheets -> Classify -> Merge (In 1)
#                               Setup -> Merge (In 0)
#                               Merge -> Cleanup
new_conns = {}

if trigger_node and setup_node:
    new_conns[trigger_node["name"]] = {"main": [[{"node": setup_node["name"], "type": "main", "index": 0}]]}

if setup_node and extract_thumbs_node and merge_node:
    new_conns[setup_node["name"]] = {"main": [[
        {"node": extract_thumbs_node["name"], "type": "main", "index": 0},
        {"node": merge_node["name"], "type": "main", "index": 0}
    ]]}

if extract_thumbs_node and sheets_node:
    new_conns[extract_thumbs_node["name"]] = {"main": [[{"node": sheets_node["name"], "type": "main", "index": 0}]]}

if sheets_node and classify_node:
    new_conns[sheets_node["name"]] = {"main": [[{"node": classify_node["name"], "type": "main", "index": 0}]]}

if classify_node and merge_node:
    new_conns[classify_node["name"]] = {"main": [[{"node": merge_node["name"], "type": "main", "index": 1}]]}

if merge_node and cleanup_node:
    new_conns[merge_node["name"]] = {"main": [[{"node": cleanup_node["name"], "type": "main", "index": 0}]]}

data["connections"] = new_conns

# 3. Clean up pinData and meta
data["pinData"] = {}
if "meta" in data:
    # Optional: Keep instanceId but reset version
    data["versionId"] = "" 

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Workflow repaired successfully with robust connections and Merge node fix.")
