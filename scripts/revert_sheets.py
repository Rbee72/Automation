import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

for node in data["nodes"]:
    # 1. Update Google Sheets Node (Get row(s) in sheet)
    if node["name"] == "Get row(s) in sheet":
        # Ensure we are targeting the correct lookupValue
        # The user's sheet uses underscores, so we use folderName
        node["parameters"]["filtersUI"]["values"][0]["lookupValue"] = "={{ JSON.parse($node[\"Execute Command1\"].json.stdout).folderName }}"

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Updated eBook Ingestion.json: Reverted Sheets lookup to folderName")
