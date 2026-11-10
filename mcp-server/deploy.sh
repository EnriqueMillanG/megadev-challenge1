#!/usr/bin/env bash
# Deploys this server to Cloud Run in the active gcloud project. Safe to run again: it only
# creates what is missing, then deploys a new revision.
#   ./deploy.sh            uses the active gcloud configuration's project
#   REGION=europe-west1 ./deploy.sh
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-schema-first}"
BUCKET="${BUCKET:-${PROJECT}-schema-first}"
SECRET="${SERVICE}-owner-password"
RUN_SA="${SERVICE}-run@${PROJECT}.iam.gserviceaccount.com"

[ -n "$PROJECT" ] || { echo "No project. Run: gcloud config set project <id>"; exit 1; }
echo "Project: $PROJECT  Region: $REGION  Account: $(gcloud config get-value account 2>/dev/null)"
NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
URL="https://${SERVICE}-${NUMBER}.${REGION}.run.app"

echo "== APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com --project "$PROJECT"

echo "== Bucket gs://$BUCKET (private)"
if ! gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location "$REGION" \
    --uniform-bucket-level-access --public-access-prevention
fi

echo "== Owner password (Secret Manager: $SECRET)"
if ! gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  head -c 18 /dev/urandom | base64 | tr -d '/+=' | gcloud secrets create "$SECRET" --project "$PROJECT" \
    --replication-policy automatic --data-file=-
  NEW_PASSWORD=1
fi

echo "== Service account $RUN_SA"
if ! gcloud iam service-accounts describe "$RUN_SA" --project "$PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SERVICE}-run" --project "$PROJECT" --display-name "schema-first MCP server"
  sleep 10
fi
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member "serviceAccount:$RUN_SA" \
  --role roles/storage.objectAdmin --project "$PROJECT" >/dev/null
gcloud secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:$RUN_SA" \
  --role roles/secretmanager.secretAccessor --project "$PROJECT" >/dev/null

# Builds from source use the default compute service account; new projects may not grant it the builder role.
gcloud projects add-iam-policy-binding "$PROJECT" --condition=None \
  --member "serviceAccount:${NUMBER}-compute@developer.gserviceaccount.com" \
  --role roles/cloudbuild.builds.builder >/dev/null

echo "== Deploy $SERVICE -> $URL (builds whisper.cpp; the first build takes ~10 minutes)"
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source . \
  --service-account "$RUN_SA" --allow-unauthenticated \
  --cpu 2 --memory 2Gi --max-instances 1 --concurrency 20 --timeout 900 \
  --set-env-vars "PUBLIC_URL=${URL},BUCKET=${BUCKET},WHISPER_THREADS=2" \
  --set-secrets "OWNER_PASSWORD=${SECRET}:latest"

echo
echo "Server:   ${URL}/mcp"
echo "Plan:     ${URL}/plan"
if [ "${NEW_PASSWORD:-0}" = 1 ]; then
  echo "Owner password (shown once here; read it later with the command below):"
  gcloud secrets versions access latest --secret "$SECRET" --project "$PROJECT"; echo
fi
echo "Read the owner password: gcloud secrets versions access latest --secret $SECRET --project $PROJECT"
