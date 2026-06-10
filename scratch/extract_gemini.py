with open('frontend/pages/manager_system.html', 'r') as f:
    html = f.read()

# The card starts with <div class="glass-card" id="gemini-config-card"
start_idx = html.find('<div class="glass-card" id="gemini-config-card"')

if start_idx != -1:
    # Find the closing div. This card has 3 nested divs inside it. 
    # Let's count divs to find the matching closing div.
    div_count = 0
    end_idx = -1
    i = start_idx
    while i < len(html):
        if html.startswith('<div', i):
            div_count += 1
        elif html.startswith('</div', i):
            div_count -= 1
            if div_count == 0:
                end_idx = i + 6  # length of </div>
                break
        i += 1
    
    if end_idx != -1:
        gemini_html = html[start_idx:end_idx]
        
        # Remove it from its original location
        html = html[:start_idx] + html[end_idx:]
        
        # Now find a good place to insert it. Before Danger Zone.
        # Danger zone starts with:
        # <hr style="border-color:rgba(255,255,255,0.1); margin:40px 0;"/>
        # <div class="glass-card" style="padding:30px; border:1px solid var(--danger);
        
        danger_idx = html.find('<hr style="border-color:rgba(255,255,255,0.1); margin:40px 0;"/>')
        if danger_idx != -1:
            new_section = f"""
            </section>
            
            <!-- Gemini Settings Section -->
            <section class="section-content" id="system-gemini">
                <div class="glass-card section-card">
                    <h3 data-i18n="gemini_mgmt">AI API Configuration</h3>
                    <p data-i18n="gemini_mgmt_desc" style="color:var(--text-muted); margin-bottom: 20px;">Manage your Google Gemini API Keys for LLM-powered features.</p>
                    {gemini_html}
                </div>
            </section>
            
            <section class="section-content">
            """
            html = html[:danger_idx] + new_section + html[danger_idx:]
            
            with open('frontend/pages/manager_system.html', 'w') as f:
                f.write(html)
            print("Successfully extracted Gemini card!")
        else:
            print("Could not find Danger zone")
    else:
        print("Could not find end of Gemini card")
else:
    print("Could not find Gemini card")

