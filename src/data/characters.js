// Solo opponents — exact values from the Arena of Arms PRD. Do not change.
const CHARACTERS = [
  {
    id: "rookie",
    name: "Rookie Grip",
    fighter: 'Karan "Steel Palm" Yadav',
    difficulty: "Easy",
    pressure: 4, // points lost per second
    color: "#3ea6ff",
    tagline: "Slow reaction, low resistance.",
  },
  {
    id: "ironlock",
    name: "Iron Lock",
    fighter: 'Aditya "Blaze Arm" Nath',
    difficulty: "Medium",
    pressure: 7,
    color: "#ff9d3e",
    tagline: "Balanced timing and resistance.",
  },
  {
    id: "titan",
    name: "Titan Breaker",
    fighter: 'Surya "Storm Grip" Pratap',
    difficulty: "Hard",
    pressure: 10,
    color: "#ff4d4d",
    tagline: "Aggressive, fast counter pressure.",
  },
];

export default CHARACTERS;
export const getCharacter = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
