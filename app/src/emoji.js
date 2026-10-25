// The emoji picker's list: chosen for labels (pantry, storage, tools, garden, warnings),
// each with a name and search words. Any other emoji can still be typed or pasted.
const LIST = `
📦 box package parcel storage moving
🏷️ label tag price
📁 folder file documents
🗂️ dividers index files
📎 paperclip clip office
✂️ scissors cut craft
📌 pin pushpin
📍 pin location place
🔑 key keys spare
🔒 lock locked secure private
🔓 unlocked open
💡 bulb light idea lamp
🔌 plug power cable electric
🔋 battery charge power
🪫 low battery empty
🖨️ printer print
💻 laptop computer
🖥️ desktop computer monitor
⌨️ keyboard
🖱️ mouse computer
📱 phone mobile
☎️ telephone landline
🎧 headphones audio music
📷 camera photo
📺 tv television
🎮 game controller console
🕹️ joystick game arcade
💾 disk save floppy
💿 cd disc
📀 dvd disc
🧾 receipt bill
📄 page document paper
📝 memo note write
✏️ pencil write
🖊️ pen write
🖍️ crayon draw kids
📏 ruler measure
📐 triangle ruler set square
📚 books library reading
📖 book open reading
📓 notebook
📅 calendar date
⏰ alarm clock time
⏳ hourglass timer waiting
🏠 house home
🛏️ bed bedroom sleep
🛋️ sofa couch living room
🚪 door
🪟 window
🛁 bath bathtub bathroom
🚿 shower bathroom
🚽 toilet bathroom
🧴 lotion bottle shampoo
🧼 soap wash clean
🧽 sponge clean dishes
🧹 broom sweep clean
🧺 basket laundry
🪣 bucket mop
🗑️ bin trash rubbish waste
♻️ recycle recycling
🧯 extinguisher fire safety
🪴 plant pot houseplant
🧸 teddy bear toy kids
🎁 gift present
🧰 toolbox tools
🔧 wrench spanner tool
🔨 hammer tool
🪛 screwdriver tool
🔩 nut bolt screw hardware
⚙️ gear cog settings
🪚 saw tool wood
🪜 ladder
🧲 magnet
🧵 thread sewing spool
🧶 yarn wool knitting
🪡 needle sewing
🧷 safety pin sewing
🎨 paint palette art
🖌️ paintbrush paint art
🍎 apple fruit
🍐 pear fruit
🍊 orange fruit citrus
🍋 lemon fruit citrus
🍌 banana fruit
🍇 grapes fruit
🍓 strawberry fruit berry
🫐 blueberries fruit berry
🍒 cherries fruit
🍑 peach fruit
🥭 mango fruit
🍍 pineapple fruit
🥥 coconut
🥝 kiwi fruit
🍅 tomato vegetable
🥑 avocado
🍆 aubergine eggplant vegetable
🥔 potato vegetable
🥕 carrot vegetable
🌽 corn maize vegetable
🌶️ chili pepper hot spicy
🫑 bell pepper vegetable
🥒 cucumber vegetable
🥬 lettuce greens leafy
🥦 broccoli vegetable
🧄 garlic
🧅 onion
🍄 mushroom
🥜 peanuts nuts
🌰 chestnut nut
🫘 beans legumes
🍞 bread loaf
🥐 croissant pastry
🥖 baguette bread
🥨 pretzel
🥯 bagel
🥞 pancakes
🧇 waffle
🧀 cheese
🥚 egg eggs
🍳 frying egg cooking pan
🧈 butter
🥓 bacon
🥩 meat steak
🍗 chicken poultry
🍖 meat bone
🌭 hot dog sausage
🍔 burger
🍟 fries chips
🍕 pizza
🥪 sandwich
🌮 taco
🌯 burrito wrap
🥗 salad
🍝 pasta spaghetti
🍜 noodles ramen soup
🍲 stew pot soup
🍛 curry rice
🍚 rice
🍙 rice ball onigiri
🍣 sushi
🥟 dumpling
🍤 prawn shrimp
🐟 fish
🦐 shrimp prawn seafood
🥫 can tin canned food
🧂 salt
🫙 jar
🍯 honey
🍪 cookie biscuit
🍫 chocolate
🍬 candy sweets
🍭 lollipop sweets
🍩 doughnut donut
🍰 cake slice
🎂 birthday cake
🧁 cupcake muffin
🥧 pie
🍨 ice cream
🍦 soft serve ice cream
🥛 milk
☕ coffee hot drink
🍵 tea
🧃 juice box
🥤 soda cup drink
🧋 bubble tea
🍷 wine
🍺 beer
🍸 cocktail
🧊 ice cube frozen
❄️ snowflake frozen freezer cold winter
🔥 fire hot flame
💧 water drop
🌱 seedling sprout plant
🌿 herb leaves
🍃 leaves
🌳 tree
🌵 cactus
🌸 blossom flower
🌻 sunflower flower
🌷 tulip flower
🌹 rose flower
🍀 clover luck
🐶 dog puppy pet
🐱 cat kitten pet
🐰 rabbit bunny pet
🐹 hamster pet
🐦 bird
🐔 chicken hen
🐝 bee honey
🐞 ladybird ladybug
🐢 turtle tortoise
🐠 tropical fish aquarium
🦴 bone dog treat
🐾 paws pet
👶 baby
🧒 child kid
👕 shirt t-shirt clothes
👖 jeans trousers clothes
🧦 socks clothes
🧥 coat jacket clothes
👗 dress clothes
👟 shoe trainer sneaker
🧢 cap hat
🧤 gloves
🧣 scarf winter
👜 handbag bag
🎒 backpack school bag
💼 briefcase work
🧳 luggage suitcase travel
⚽ football soccer ball sport
🏀 basketball
🎾 tennis
🚲 bicycle bike
🚗 car
🏕️ camping tent
🎄 christmas tree
🎃 pumpkin halloween
🎉 party celebration
🎈 balloon party
❤️ heart love red
⭐ star favourite
✨ sparkles new clean
✅ check tick done yes
☑️ checkbox ticked
✔️ check mark tick
❌ cross no wrong
⚠️ warning caution
⛔ no entry stop forbidden
🚫 prohibited not allowed
☢️ radioactive hazard
☣️ biohazard hazard
⚡ lightning electric high voltage
❗ exclamation important
❓ question unknown
ℹ️ information info
🔞 adults only
💊 pill medicine tablet
🩹 plaster bandage first aid
🩺 stethoscope doctor medical
💉 syringe injection vaccine
🧪 test tube chemistry lab
🌡️ thermometer temperature
☀️ sun sunny summer
🌙 moon night
☁️ cloud
☔ umbrella rain
⬆️ up arrow this way up
⬇️ down arrow
⬅️ left arrow
➡️ right arrow
↗️ up right arrow
🔄 refresh rotate cycle
🔝 top
🆕 new
🆓 free
🔢 numbers
`;

/** @type {{char: string, words: string}[]} */
export const EMOJI = LIST.trim()
	.split("\n")
	.map((line) => {
		const [char, ...words] = line.split(" ");
		return { char, words: words.join(" ") };
	});

/** Emoji whose name or search words start with every word of the query, best first. */
export const searchEmoji = (query) => {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return EMOJI;
	const found = EMOJI.filter((e) => {
		const words = e.words.split(" ");
		return terms.every((t) => words.some((w) => w.startsWith(t)) || e.char === t);
	});
	// Matches on the name (the first word) come before matches on other search words.
	const byName = (e) => (e.words.startsWith(terms[0]) ? 0 : 1);
	return found.sort((a, b) => byName(a) - byName(b));
};
