// Solo opponents — pressure values raised across the board for a harder game.
const CHARACTERS = [
  {
    id: "rookie",
    name: "Rookie Grip",
    fighter: 'Karan "Steel Palm" Yadav',
    difficulty: "Easy",
    pressure: 6, // points lost per second
    color: "#3ea6ff",
    tagline: "Slow reaction, low resistance.",
  },
  {
    id: "ironlock",
    name: "Iron Lock",
    fighter: 'Aditya "Blaze Arm" Nath',
    difficulty: "Medium",
    pressure: 11,
    color: "#ff9d3e",
    tagline: "Balanced timing and resistance.",
  },
  {
    id: "titan",
    name: "Titan Breaker",
    fighter: 'Surya "Storm Grip" Pratap',
    difficulty: "Hard",
    pressure: 16,
    color: "#ff4d4d",
    tagline: "Aggressive, fast counter pressure.",
  },
];

export default CHARACTERS;
export const getCharacter = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
