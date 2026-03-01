import json

with open("eBook Ingestion.json", "r") as f:
    data = json.load(f)

for node in data["nodes"]:
    # 1. Update Setup Node (Execute Command1)
    if node["name"] == "Execute Command1":
        node["parameters"]["command"] = """=# 1. Setup paths
BASE_DIR="/data/output"
ARCHIVE_DIR="$BASE_DIR/archive"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M)

mkdir -p "$ARCHIVE_DIR"

# 2. Find newest zip
cd "$BASE_DIR"
LATEST_ZIP=$(ls -t *.zip 2>/dev/null | head -1)

if [ -z "$LATEST_ZIP" ]; then
  echo '{"error": "No zip file found"}'
  exit 1
fi

FOLDER_NAME="${LATEST_ZIP%.*}"
# Generate sanitized name for Google Sheets (replace underscores with spaces and trim)
CLEAN_NAME=$(echo "$FOLDER_NAME" | sed 's/_/ /g' | xargs)

TARGET_DIR="$BASE_DIR/$FOLDER_NAME"

# Avoid overwrite
if [ -d "$TARGET_DIR" ]; then
  TARGET_DIR="${TARGET_DIR}_$TIMESTAMP"
fi

mkdir -p "$TARGET_DIR"

# 3. Unzip and Cleanup
unzip -qo "$LATEST_ZIP" -d "$TARGET_DIR" > /dev/null 2>&1

cd "$TARGET_DIR"
rm -rf search* index* config* annotations* thumbnails* > /dev/null 2>&1

# 4. RENAME FOLDERS & HTML
for f in [0-9] [0-9][0-9] [0-9][0-9][0-9]; do
  if [ -d "$f" ]; then
    new_d=$(echo "$f" | sed 's/^0*//')
    [ -z "$new_d" ] && new_d="0"
    [ "$f" != "$new_d" ] && mv "$f" "$new_d" > /dev/null 2>&1
  fi
  html_file="$f.html"
  if [ -f "$html_file" ]; then
    new_f=$(echo "$f" | sed 's/^0*//').html
    [ "$html_file" != "$new_f" ] && mv "$html_file" "$new_f" > /dev/null 2>&1
  fi
done

# 5. Handle PDF
PDF_MATCH="$BASE_DIR/$FOLDER_NAME.pdf"
[ ! -f "$PDF_MATCH" ] && PDF_MATCH="$BASE_DIR/$FOLDER_NAME.PDF"
if [ -f "$PDF_MATCH" ]; then
  mv "$PDF_MATCH" "$TARGET_DIR/" > /dev/null 2>&1
fi

# 6. Archive Zip
mv "$BASE_DIR/$LATEST_ZIP" "$ARCHIVE_DIR/" > /dev/null 2>&1

# 7. RETURN JSON
echo "{\\"folderName\\":\\"$FOLDER_NAME\\", \\"cleanFolderName\\":\\"$CLEAN_NAME\\", \\"targetDir\\\":\\"$TARGET_DIR\\"}" """

    # 2. Update Extract Thumbnails Node (Removed pdftoppm fallback)
    elif node["name"] == "Extract Thumbnails":
        node["parameters"]["command"] = """=# 1. Grab directory
TARGET_DIR="{{ JSON.parse($node[\"Execute Command1\"].json.stdout).targetDir }}"

# 2. Find PDF
PDF_FILE=$(find "$TARGET_DIR" -maxdepth 1 -name "*.pdf" -o -name "*.PDF" | head -1)

if [ -z "$PDF_FILE" ]; then
  echo "{\\"status\\": \\"error\\", \\"msg\\": \\"No PDF found\\"}"
  exit 1
fi

# 3. Extract using mutool exclusively
# If mutool is not found, this will return exit code 127
if mutool draw -r 300 -o "$TARGET_DIR/%d.jpg" "$PDF_FILE"; then
  echo "{\\"status\\": \\"success\\", \\"msg\\": \\"Thumbnails generated via mutool\\"}"
else
  # Clear and specific error message
  echo "{\\"status\\": \\"error\\", \\"msg\\": \\"mutool failed to extract thumbnails. Check if mutool is installed in the container.\\"}"
  exit 1
fi"""

    # 3. Update Classification Node (Execute Command3)
    elif node["name"] == "Execute Command3":
        node["parameters"]["command"] = """=# 1. Variables
TARGET_DIR="{{ JSON.parse($node[\"Execute Command1\"].json.stdout).targetDir }}"
TITLE="{{ $json[\"ChapterTitle\"] }}"
START={{ $json[\"StartPage\"] }}
END={{ $json[\"EndPage\"] }}

BOOK_PATH="$TARGET_DIR"
CHAPTER_PATH="$BOOK_PATH/$TITLE"

# 2. Create Chapter Folder
mkdir -p "$CHAPTER_PATH"

# 3. Move unique assets
if [ ! -z "$START" ] && [ ! -z "$END" ]; then
  for i in $(seq "$START" "$END"); do
    [ -f "$BOOK_PATH/$i.html" ] && mv "$BOOK_PATH/$i.html" "$CHAPTER_PATH/"
    [ -f "$BOOK_PATH/$i.jpg" ] && mv "$BOOK_PATH/$i.jpg" "$CHAPTER_PATH/"
    [ -d "$BOOK_PATH/$i" ] && mv "$BOOK_PATH/$i" "$CHAPTER_PATH/"
  done
fi

# 4. Handle Fonts
[ -d "$BOOK_PATH/fonts" ] && cp -r "$BOOK_PATH/fonts" "$CHAPTER_PATH/"

# 5. Handle PDF
PDF_FILE=$(find "$BOOK_PATH" -maxdepth 1 -name "*.pdf" -o -name "*.PDF" | head -1)
[ ! -z "$PDF_FILE" ] && cp "$PDF_FILE" "$CHAPTER_PATH/"

echo "{\\"status\\\": \\"success\\\", \\\"chapter\\\": \\\"$TITLE\\\"}" """

with open("eBook Ingestion.json", "w") as f:
    json.dump(data, f, indent=2)

print("Updated eBook Ingestion.json successfully")
