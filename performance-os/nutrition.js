// ── NUTRITION MODULE ──
// Performance OS — Nutrition features
// Loaded separately from index.html to keep core app lean
//
// Planned features:
//   1. Pantry Tracker (Staples / Freezer / Fresh This Week)
//   2. Sunday Meal Planner (Claude generates from pantry + training week)
//   3. Grocery List Generator (meal plan vs pantry)
//   4. Daily Macro Tracker (pre-planned + on-demand estimates)
//   5. Hawker meal estimator (Claude estimates macros from description)
//
// Data stored in Google Drive under _nutrition key:
//   _nutrition: {
//     pantry: { staples: [], freezer: [], fresh: [] },
//     mealPlan: { weekOf: '', meals: {} },
//     macroLog: { 'YYYY-MM-DD': [] },
//     recipes: []
//   }

// ── PLACEHOLDER FUNCTIONS ──
// These will be built out in subsequent sessions

function buildNutritionScreen() {
  // TODO: Main nutrition dashboard
  console.log('Nutrition module loaded — coming soon');
}

function buildPantryTracker() {
  // TODO: Three-tier pantry (staples / freezer / fresh)
}

function buildMealPlanner() {
  // TODO: Sunday meal planning with Claude
}

function generateGroceryList() {
  // TODO: Auto-generate from meal plan vs pantry
}

function buildMacroTracker() {
  // TODO: Daily macro log
}

async function estimateHawkerMeal(description) {
  // TODO: Claude estimates macros from hawker meal description
}

console.log('nutrition.js loaded');
